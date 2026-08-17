"""A deterministic stand-in for the model.

`provider: "mock"` runs the whole graph — fan-out, revision loop, action stage —
without an API key, so the topology and the frontend can be exercised offline.
It generates schema-shaped data; it does not do the task.
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable, Optional

from .config import GraphConfig, RoleConfig
from .llm import AgentResult, Budget, Provider, Usage


def _seed(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)


class MockProvider(Provider):
    def __init__(self, config: GraphConfig):
        super().__init__(config)
        self._round = 0

    # The mock never opens a client.
    @property
    def client(self):  # pragma: no cover - guard against accidental live calls
        raise RuntimeError("the mock provider makes no network calls")

    def _charge(self, budget: Budget) -> Usage:
        usage = Usage(input_tokens=800, output_tokens=300, calls=1)
        budget.usage.add(usage)
        return usage

    def call_json(
        self, *, role: RoleConfig, system: str, prompt: str, schema: dict,
        budget: Budget,
    ) -> tuple[dict, Usage]:
        budget.check()
        usage = self._charge(budget)

        props = set(schema.get("properties", {}))
        if "research_tasks" in props:
            return self._plan(prompt), usage
        if "needs_more_research" in props:
            return self._critique(prompt), usage
        return _synthesize(schema, prompt), usage

    def structure(self, **kwargs) -> tuple[dict, Usage]:
        return self.call_json(**kwargs)

    def call_agent(
        self, *, role: RoleConfig, system: str, prompt: str, tools: list[dict],
        executor: Callable[[str, dict], str], budget: Budget, max_iterations: int,
        on_event: Optional[Callable[[dict], None]] = None,
    ) -> AgentResult:
        budget.check()
        usage = self._charge(budget)
        subject = prompt.splitlines()[1] if len(prompt.splitlines()) > 1 else prompt
        text = (
            f"[mock] Worked on: {subject[:200]}\n\n"
            "Findings are synthetic. Set provider to 'anthropic' with credentials "
            "available for a real run."
        )
        return AgentResult(
            text=text,
            sources=[{"title": "mock source", "url": "https://example.invalid/mock"}],
            usage=usage,
        )

    # -- shaped fakes -----------------------------------------------------

    def _plan(self, prompt: str) -> dict:
        limits = self.config.limits
        gap_round = "gap filling" in prompt
        n_research = min(2 if gap_round else 3, limits.max_research_agents)
        n_workers = min(1 if gap_round else 2, limits.max_worker_agents)
        n_actions = (
            0 if self.config.action_mode == "off"
            else min(1, limits.max_action_agents)
        )
        tag = "r2" if gap_round else "r1"

        return {
            "objective": (self.config.task or "the supplied task")[:200],
            "task_type": "research",
            "complexity": 3,
            "success_criteria": [
                "The deliverable answers the task directly.",
                "Every substantive claim is attributed to a source.",
            ],
            "research_tasks": [
                {
                    "id": f"{tag}-research-{i + 1}",
                    "question": f"[mock] Research angle {i + 1} of the task.",
                    "why": "Synthetic plan produced by the mock provider.",
                    "depth": "normal",
                }
                for i in range(n_research)
            ],
            "worker_tasks": [
                {
                    "id": f"{tag}-worker-{i + 1}",
                    "instruction": f"[mock] Draft section {i + 1} from the findings.",
                    "output_format": "prose",
                    "needs_findings": True,
                }
                for i in range(n_workers)
            ],
            "needs_action": n_actions > 0,
            "action_tasks": [
                {
                    "id": f"{tag}-action-{i + 1}",
                    "description": "[mock] Save the deliverable to the workspace.",
                    "kind": "write_file",
                }
                for i in range(n_actions)
            ],
            "reasoning": "Mock plan: fixed shape, clamped to the configured ceilings.",
        }

    def _critique(self, prompt: str) -> dict:
        # First compile asks for one more round; the second is satisfied, so the
        # revision loop is exercised exactly once.
        self._round += 1
        first_pass = self._round == 1 and self.config.limits.max_rounds > 1
        return {
            "deliverable": (
                "# [mock] Deliverable\n\n"
                "This is synthetic output from the mock provider. The graph ran "
                f"end to end across {self._round} compile pass(es).\n\n"
                "Set provider to 'anthropic' for a real run."
            ),
            "coverage": "partial" if first_pass else "complete",
            "unmet_criteria": ["[mock] one criterion left open"] if first_pass else [],
            "needs_more_research": first_pass,
            "followup_questions": (
                ["[mock] What remains unresolved?"] if first_pass else []
            ),
            "caveats": ["Output is synthetic — produced by the mock provider."],
        }


def _synthesize(schema: dict, prompt: str) -> Any:
    """Build a value that satisfies `schema`, deterministically."""
    stype = schema.get("type")

    if "enum" in schema:
        options = schema["enum"]
        return options[_seed(prompt + str(options)) % len(options)]

    if stype == "object":
        return {
            key: _synthesize(sub, prompt + key)
            for key, sub in schema.get("properties", {}).items()
        }
    if stype == "array":
        item = schema.get("items", {"type": "string"})
        return [_synthesize(item, prompt + str(i)) for i in range(2)]
    if stype == "boolean":
        return False
    if stype == "integer":
        return 1 + _seed(prompt) % 5
    if stype == "number":
        return round(0.1 + (_seed(prompt) % 90) / 100, 2)
    return f"[mock] {prompt.strip().splitlines()[0][:120] if prompt.strip() else 'value'}"
