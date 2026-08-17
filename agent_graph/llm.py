"""Model layer.

LangGraph owns the topology; this module owns every call to Claude. It offers
two primitives that the nodes build on:

    call_json(...)   one shot, response constrained to a JSON Schema
    call_agent(...)  a tool-use loop with server tools + local tools

Both accept a `Budget` so a runaway plan hits a ceiling instead of your bill.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

from .config import GraphConfig, RoleConfig

# Fable 5 rejects any explicit `thinking` config — thinking is always on there.
_NO_THINKING_PARAM = {"claude-fable-5", "claude-mythos-5"}
# Disabling thinking is only legal at effort `high` or below.
_HIGH_EFFORTS = {"xhigh", "max"}
# Streaming is required above this many output tokens or the request can hit
# the SDK's HTTP timeout.
_STREAM_THRESHOLD = 16000


class BudgetExceeded(RuntimeError):
    pass


class ModelRefusal(RuntimeError):
    """The safety classifiers declined the request."""

    def __init__(self, category: Optional[str], explanation: str = ""):
        self.category = category
        super().__init__(f"model refused (category={category}): {explanation}".strip())


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    calls: int = 0
    web_searches: int = 0

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens
        self.calls += other.calls
        self.web_searches += other.web_searches

    def as_dict(self) -> dict:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "calls": self.calls,
            "web_searches": self.web_searches,
        }


@dataclass
class Budget:
    """Shared across every agent in one run."""

    max_calls: int
    usage: Usage = field(default_factory=Usage)

    def check(self) -> None:
        if self.usage.calls >= self.max_calls:
            raise BudgetExceeded(
                f"run hit its ceiling of {self.max_calls} model calls"
            )


@dataclass
class AgentResult:
    text: str
    sources: list[dict] = field(default_factory=list)
    tool_calls: list[dict] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    stop_reason: str = "end_turn"


def _output_config(role: RoleConfig, schema: Optional[dict] = None) -> dict:
    cfg: dict[str, Any] = {"effort": role.effort}
    if schema is not None:
        cfg["format"] = {"type": "json_schema", "schema": schema}
    return cfg


def _thinking_param(role: RoleConfig) -> Optional[dict]:
    if role.model in _NO_THINKING_PARAM:
        return None  # always on; sending anything is a 400
    if role.thinking:
        return {"type": "adaptive"}
    if role.effort in _HIGH_EFFORTS:
        # `disabled` + xhigh/max is rejected; adaptive is the safe reading of
        # "the caller asked for maximum effort".
        return {"type": "adaptive"}
    return {"type": "disabled"}


def _usage_from(response: Any) -> Usage:
    u = getattr(response, "usage", None)
    if u is None:
        return Usage(calls=1)
    searches = 0
    server_tool_use = getattr(u, "server_tool_use", None)
    if server_tool_use is not None:
        searches = getattr(server_tool_use, "web_search_requests", 0) or 0
    return Usage(
        input_tokens=getattr(u, "input_tokens", 0) or 0,
        output_tokens=getattr(u, "output_tokens", 0) or 0,
        cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
        cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0,
        calls=1,
        web_searches=searches,
    )


def _text_of(response: Any) -> str:
    return "\n".join(
        b.text for b in response.content if getattr(b, "type", None) == "text"
    ).strip()


def _guard_refusal(response: Any) -> None:
    if getattr(response, "stop_reason", None) == "refusal":
        details = getattr(response, "stop_details", None)
        raise ModelRefusal(
            getattr(details, "category", None),
            getattr(details, "explanation", "") or "",
        )


class Provider:
    """Thin wrapper over the Anthropic SDK, plus the mock stand-in."""

    def __init__(self, config: GraphConfig):
        self.config = config
        self._client = None

    @property
    def client(self):
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic()
        return self._client

    # -- request plumbing -------------------------------------------------

    def _system(self, text: str) -> Any:
        if not self.config.prompt_caching:
            return text
        return [
            {
                "type": "text",
                "text": text,
                "cache_control": {"type": "ephemeral"},
            }
        ]

    def _create(self, **kwargs) -> Any:
        """One request. Streams when the output budget is large."""
        if kwargs.get("max_tokens", 0) > _STREAM_THRESHOLD:
            with self.client.messages.stream(**kwargs) as stream:
                return stream.get_final_message()
        return self.client.messages.create(**kwargs)

    # -- primitives -------------------------------------------------------

    def call_json(
        self,
        *,
        role: RoleConfig,
        system: str,
        prompt: str,
        schema: dict,
        budget: Budget,
    ) -> tuple[dict, Usage]:
        """Ask for one JSON object matching `schema`. No tools involved."""
        budget.check()
        kwargs: dict[str, Any] = {
            "model": role.model,
            "max_tokens": role.max_tokens,
            "system": self._system(system),
            "messages": [{"role": "user", "content": prompt}],
            "output_config": _output_config(role, schema),
        }
        thinking = _thinking_param(role)
        if thinking is not None:
            kwargs["thinking"] = thinking

        response = self._create(**kwargs)
        usage = _usage_from(response)
        budget.usage.add(usage)
        _guard_refusal(response)

        return _parse_json(_text_of(response)), usage

    def call_agent(
        self,
        *,
        role: RoleConfig,
        system: str,
        prompt: str,
        tools: list[dict],
        executor: Callable[[str, dict], str],
        budget: Budget,
        max_iterations: int,
        on_event: Optional[Callable[[dict], None]] = None,
    ) -> AgentResult:
        """Run a tool-use loop until the model stops calling tools."""
        messages: list[dict] = [{"role": "user", "content": prompt}]
        result = AgentResult(text="")
        emit = on_event or (lambda _e: None)

        for _ in range(max_iterations):
            budget.check()
            kwargs: dict[str, Any] = {
                "model": role.model,
                "max_tokens": role.max_tokens,
                "system": self._system(system),
                "messages": messages,
                "output_config": _output_config(role),
            }
            if tools:
                kwargs["tools"] = tools
            thinking = _thinking_param(role)
            if thinking is not None:
                kwargs["thinking"] = thinking

            response = self._create(**kwargs)
            usage = _usage_from(response)
            budget.usage.add(usage)
            result.usage.add(usage)
            _guard_refusal(response)

            result.sources.extend(_collect_sources(response))
            stop = getattr(response, "stop_reason", "end_turn")
            result.stop_reason = stop

            # A server-side tool loop hit its internal cap; resend to resume.
            if stop == "pause_turn":
                messages = [
                    messages[0],
                    {"role": "assistant", "content": response.content},
                ]
                continue

            if stop != "tool_use":
                result.text = _text_of(response)
                return result

            tool_uses = [
                b for b in response.content if getattr(b, "type", None) == "tool_use"
            ]
            messages.append({"role": "assistant", "content": response.content})

            results = []
            for block in tool_uses:
                emit({"type": "tool", "name": block.name, "input": block.input})
                try:
                    output = executor(block.name, dict(block.input))
                    is_error = False
                except Exception as exc:  # surface the failure to the model
                    output = f"{type(exc).__name__}: {exc}"
                    is_error = True
                result.tool_calls.append(
                    {"name": block.name, "input": block.input,
                     "output": output[:2000], "error": is_error}
                )
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": output,
                        "is_error": is_error,
                    }
                )
            # All results go back in a single user message.
            messages.append({"role": "user", "content": results})

        result.text = result.text or "(agent stopped at its tool-iteration limit)"
        result.stop_reason = "max_iterations"
        return result

    def structure(
        self,
        *,
        role: RoleConfig,
        system: str,
        prompt: str,
        schema: dict,
        budget: Budget,
    ) -> tuple[dict, Usage]:
        """Convert free-form agent output into a schema-shaped object.

        Kept separate from `call_agent` because web search attaches citations to
        its text blocks, and citations cannot be combined with
        `output_config.format` in the same request.
        """
        return self.call_json(
            role=role, system=system, prompt=prompt, schema=schema, budget=budget
        )


def _parse_json(text: str) -> dict:
    """Structured outputs guarantee valid JSON, but stay defensive."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass
    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        return json.loads(brace.group())
    raise ValueError(f"expected JSON, got: {text[:400]!r}")


def _collect_sources(response: Any) -> list[dict]:
    """Pull citations and web-search results out of a response."""
    sources: list[dict] = []
    for block in response.content:
        btype = getattr(block, "type", None)
        if btype == "web_search_tool_result":
            content = getattr(block, "content", None)
            # On success `content` is a list of results; on error it is a single
            # object carrying an error_code.
            if isinstance(content, list):
                for item in content:
                    sources.append(
                        {
                            "title": getattr(item, "title", "") or "",
                            "url": getattr(item, "url", "") or "",
                        }
                    )
        elif btype == "text":
            for citation in getattr(block, "citations", None) or []:
                url = getattr(citation, "url", None)
                if url:
                    sources.append(
                        {
                            "title": getattr(citation, "title", "") or "",
                            "url": url,
                        }
                    )
    # De-duplicate on URL, preserving order.
    seen: set[str] = set()
    unique = []
    for src in sources:
        key = src["url"] or src["title"]
        if key and key not in seen:
            seen.add(key)
            unique.append(src)
    return unique


def has_credentials() -> bool:
    """True when a live run is plausible.

    An unset ANTHROPIC_API_KEY is not proof of no credentials — the SDK also
    reads ANTHROPIC_AUTH_TOKEN and `ant auth login` profiles — so this only
    reports the cheap, local signals.
    """
    if os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"):
        return True
    config_dir = os.getenv("ANTHROPIC_CONFIG_DIR") or os.path.expanduser(
        "~/.config/anthropic"
    )
    return os.path.isdir(os.path.join(config_dir, "credentials"))
