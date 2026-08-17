"""The five agent stages.

Each factory takes the run's config, provider, budget and event sink, and
returns a node function. Fan-out nodes receive a `Send` payload rather than the
full graph state, so the dispatcher packs whatever context they need.
"""

from __future__ import annotations

import json
import time
from typing import Callable

from . import prompts
from .config import GraphConfig
from .llm import Budget, BudgetExceeded, ModelRefusal, Provider
from .tools import build_toolset

Emit = Callable[[dict], None]


def _clamp(items: list, limit: int) -> list:
    return list(items)[: max(0, limit)]


def _agent_event(emit: Emit, stage: str, agent_id: str, status: str, **extra) -> dict:
    event = {
        "type": "agent",
        "stage": stage,
        "id": agent_id,
        "status": status,
        "at": time.time(),
        **extra,
    }
    emit(event)
    return event


def make_lead(config: GraphConfig, provider: Provider, budget: Budget, emit: Emit):
    role = config.role("lead")

    def lead(state: dict) -> dict:
        round_no = state.get("round", 0)
        agent_id = f"lead-r{round_no}"
        _agent_event(emit, "lead", agent_id, "running",
                     label=f"Planning (round {round_no + 1})")

        plan, _ = provider.call_json(
            role=role,
            system=prompts.LEAD_SYSTEM,
            prompt=prompts.lead_prompt(config, state),
            schema=prompts.PLAN_SCHEMA,
            budget=budget,
        )

        limits = config.limits
        plan["research_tasks"] = _clamp(
            plan.get("research_tasks", []), limits.max_research_agents
        )
        plan["worker_tasks"] = _clamp(
            plan.get("worker_tasks", []), limits.max_worker_agents
        )
        if config.action_mode == "off":
            plan["needs_action"] = False
            plan["action_tasks"] = []
        else:
            plan["action_tasks"] = _clamp(
                plan.get("action_tasks", []), limits.max_action_agents
            )

        _agent_event(
            emit, "lead", agent_id, "done",
            label=f"Planning (round {round_no + 1})",
            summary=(
                f"{len(plan['research_tasks'])} research, "
                f"{len(plan['worker_tasks'])} worker, "
                f"{len(plan['action_tasks'])} action"
            ),
            plan=plan,
        )
        return {"plan": plan, "trace": [{"stage": "lead", "round": round_no,
                                         "plan": plan}]}

    return lead


def make_research(config: GraphConfig, provider: Provider, budget: Budget, emit: Emit):
    role = config.role("research")
    specs, executor = build_toolset(config, "research", role.model)

    def research(payload: dict) -> dict:
        spec = payload["spec"]
        agent_id = spec.get("id") or "research"
        question = spec.get("question", "")
        _agent_event(emit, "research", agent_id, "running", label=question)

        try:
            result = provider.call_agent(
                role=role,
                system=prompts.RESEARCH_SYSTEM,
                prompt=prompts.research_prompt(spec, config, payload.get("prior", [])),
                tools=specs,
                executor=executor,
                budget=budget,
                max_iterations=config.limits.max_tool_iterations,
                on_event=lambda e: emit({**e, "stage": "research", "id": agent_id}),
            )
            structured, _ = provider.structure(
                role=role,
                system=(
                    "Restate the research report below as structured data. Use only "
                    "what the report contains; do not add findings of your own."
                ),
                prompt=result.text,
                schema=prompts.FINDING_SCHEMA,
                budget=budget,
            )
            finding = {
                "id": agent_id,
                "question": question,
                "report": result.text,
                "sources": result.sources,
                "tool_calls": len(result.tool_calls),
                **structured,
            }
            _agent_event(emit, "research", agent_id, "done", label=question,
                         summary=structured.get("summary", "")[:400],
                         sources=len(result.sources))
        except ModelRefusal as exc:
            finding = _failed_finding(agent_id, question, str(exc), "refused")
            _agent_event(emit, "research", agent_id, "error", label=question,
                         summary=str(exc))
        except BudgetExceeded:
            raise  # a budget stop ends the whole run, not just this agent
        except Exception as exc:  # one agent failing must not sink the run
            finding = _failed_finding(agent_id, question,
                                      f"{type(exc).__name__}: {exc}", "error")
            _agent_event(emit, "research", agent_id, "error", label=question,
                         summary=f"{type(exc).__name__}: {exc}")

        return {"findings": [finding]}

    return research


def _failed_finding(agent_id: str, question: str, detail: str, kind: str) -> dict:
    return {
        "id": agent_id,
        "question": question,
        "summary": f"This question was not answered ({kind}): {detail}",
        "key_points": [],
        "confidence": "low",
        "gaps": [question],
        "sources": [],
        "report": "",
        "failed": True,
    }


def make_worker(config: GraphConfig, provider: Provider, budget: Budget, emit: Emit):
    role = config.role("worker")
    specs, executor = build_toolset(config, "worker", role.model)

    def worker(payload: dict) -> dict:
        spec = payload["spec"]
        agent_id = spec.get("id") or "worker"
        label = spec.get("instruction", "")[:120]
        _agent_event(emit, "worker", agent_id, "running", label=label)

        try:
            result = provider.call_agent(
                role=role,
                system=prompts.WORKER_SYSTEM,
                prompt=prompts.worker_prompt(spec, config, payload.get("findings", [])),
                tools=specs,
                executor=executor,
                budget=budget,
                max_iterations=config.limits.max_tool_iterations,
                on_event=lambda e: emit({**e, "stage": "worker", "id": agent_id}),
            )
            structured, _ = provider.structure(
                role=role,
                system=(
                    "Restate the worker output below as structured data, "
                    "preserving the produced artifact verbatim in `output`."
                ),
                prompt=result.text,
                schema=prompts.ARTIFACT_SCHEMA,
                budget=budget,
            )
            artifact = {
                "id": agent_id,
                "instruction": spec.get("instruction", ""),
                **structured,
            }
            _agent_event(emit, "worker", agent_id, "done", label=label,
                         summary=structured.get("output", "")[:400])
        except BudgetExceeded:
            raise
        except Exception as exc:
            artifact = {
                "id": agent_id,
                "instruction": spec.get("instruction", ""),
                "output": "",
                "notes": f"This worker failed: {type(exc).__name__}: {exc}",
                "assumptions": [],
                "failed": True,
            }
            _agent_event(emit, "worker", agent_id, "error", label=label,
                         summary=f"{type(exc).__name__}: {exc}")

        return {"artifacts": [artifact]}

    return worker


def make_compiler(config: GraphConfig, provider: Provider, budget: Budget, emit: Emit):
    role = config.role("compiler")

    def compile_node(state: dict) -> dict:
        round_no = state.get("round", 0)
        agent_id = f"compiler-r{round_no}"
        _agent_event(emit, "compiler", agent_id, "running", label="Compiling findings")

        critique, _ = provider.call_json(
            role=role,
            system=prompts.COMPILER_SYSTEM,
            prompt=prompts.compile_prompt(config, state),
            schema=prompts.COMPILE_SCHEMA,
            budget=budget,
        )

        report = critique.get("deliverable", "")
        update: dict = {
            "report": report,
            "critique": critique,
            "round": round_no + 1,
            "trace": [{"stage": "compiler", "round": round_no, "critique": critique}],
        }

        # A caller-supplied JSON Schema is enforced with one more constrained
        # call rather than by trusting the compiler's free-form JSON.
        deliverable = config.deliverable
        if deliverable.format == "json" and deliverable.json_schema:
            try:
                update["structured"], _ = provider.structure(
                    role=role,
                    system=(
                        "Return the content below as a JSON object matching the "
                        "required schema. Use only what is present; do not invent "
                        "values."
                    ),
                    prompt=report,
                    schema=deliverable.json_schema,
                    budget=budget,
                )
                update["report"] = json.dumps(update["structured"], indent=2)
            except Exception as exc:
                critique.setdefault("caveats", []).append(
                    f"Could not conform the output to the supplied JSON Schema: {exc}"
                )

        _agent_event(
            emit, "compiler", agent_id, "done", label="Compiling findings",
            summary=f"coverage: {critique.get('coverage')}",
            coverage=critique.get("coverage"),
        )
        return update

    return compile_node


def make_action(config: GraphConfig, provider: Provider, budget: Budget, emit: Emit):
    role = config.role("action")
    specs, executor = build_toolset(config, "action", role.model)

    def action(payload: dict) -> dict:
        spec = payload["spec"]
        agent_id = spec.get("id") or "action"
        label = spec.get("description", "")[:120]
        _agent_event(emit, "action", agent_id, "running", label=label)

        try:
            result = provider.call_agent(
                role=role,
                system=prompts.ACTION_SYSTEM,
                prompt=prompts.action_prompt(spec, config, payload.get("report", "")),
                tools=specs if config.action_mode == "execute" else [],
                executor=executor,
                budget=budget,
                max_iterations=config.limits.max_tool_iterations,
                on_event=lambda e: emit({**e, "stage": "action", "id": agent_id}),
            )
            structured, _ = provider.structure(
                role=role,
                system="Restate the action report below as structured data.",
                prompt=result.text,
                schema=prompts.ACTION_SCHEMA,
                budget=budget,
            )
            record = {
                "id": agent_id,
                "description": spec.get("description", ""),
                "kind": spec.get("kind", "other"),
                "mode": config.action_mode,
                "tool_calls": result.tool_calls,
                **structured,
            }
            _agent_event(emit, "action", agent_id, "done", label=label,
                         summary=structured.get("detail", "")[:400],
                         action_status=structured.get("status"))
        except BudgetExceeded:
            raise
        except Exception as exc:
            record = {
                "id": agent_id,
                "description": spec.get("description", ""),
                "status": "failed",
                "detail": f"{type(exc).__name__}: {exc}",
                "artifacts": [],
            }
            _agent_event(emit, "action", agent_id, "error", label=label,
                         summary=f"{type(exc).__name__}: {exc}")

        return {"actions": [record]}

    return action
