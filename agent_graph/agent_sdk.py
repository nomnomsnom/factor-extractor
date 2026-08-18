"""Run the graph on a Claude subscription via the Claude Agent SDK.

The rest of the codebase talks to `api.anthropic.com` with an API key, which a
Pro/Max subscription does not cover — Anthropic bills the subscription and the
developer API separately. The Agent SDK is the supported bridge: it
authenticates with the Claude subscription and carries a monthly Agent SDK
credit.

Set it up once with `claude setup-token`, then `provider: "agent_sdk"`.

Two things to know about this provider:

  * It drives the Claude Code harness rather than the Messages API, so the tool
    loop belongs to the SDK. Our own tool executor is unused here; the
    configured tools are mapped onto Claude Code's built-ins and gated by
    `can_use_tool` below.
  * Each call spawns a Claude Code process. That is slower than an HTTP request
    and is why the call ceiling matters more on this provider than on the API.

Local use only. Anthropic does not permit offering claude.ai login or a
subscription's rate limits to third parties, so this cannot back the published
page — which could not run it anyway, being a browser.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Callable, Optional

from .config import GraphConfig, RoleConfig
from .llm import (
    AgentResult,
    Budget,
    ModelRefusal,
    Provider,
    Usage,
    _parse_json,
)

# Our tool names on the left, Claude Code's built-ins on the right.
TOOL_MAP: dict[str, list[str]] = {
    "web_search": ["WebSearch"],
    "web_fetch": ["WebFetch"],
    "read_file": ["Read"],
    "list_dir": ["Glob", "Grep"],
    "write_file": ["Write", "Edit"],
    # `calculator` has no built-in equivalent. Bash could do arithmetic, but
    # granting a shell to get a calculator is a bad trade, so it is dropped
    # here and the model does the arithmetic itself.
}

# Everything the harness ships. Anything not explicitly allowed is denied by
# name rather than left to the default, so an empty allowlist cannot be read as
# "no restrictions".
ALL_BUILTIN_TOOLS = [
    "Agent", "Artifact", "AskUserQuestion", "Bash", "CronCreate", "CronDelete",
    "CronList", "Edit", "EndConversation", "EnterPlanMode", "EnterWorktree",
    "ExitPlanMode", "ExitWorktree", "Glob", "Grep", "LSP", "ListAgents",
    "ListMcpResourcesTool", "Monitor", "NotebookEdit", "PowerShell",
    "PushNotification", "Read", "ReadMcpResourceTool", "RemoteTrigger",
    "ReportFindings", "ScheduleWakeup", "SendMessage", "SendUserFile",
    "ShareOnboardingGuide", "Skill", "TaskCreate", "TaskGet", "TaskList",
    "TaskOutput", "TaskStop", "TaskUpdate", "TodoWrite", "ToolSearch",
    "WaitForMcpServers", "WebFetch", "WebSearch", "Workflow", "Write",
]

FILE_TOOLS = {"Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit"}


class AgentSDKUnavailable(RuntimeError):
    pass


def _require_sdk():
    try:
        import claude_agent_sdk  # noqa: F401
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise AgentSDKUnavailable(
            "provider 'agent_sdk' needs the Claude Agent SDK and the Claude Code "
            "CLI: pip install claude-agent-sdk, then `claude setup-token` to "
            "authenticate with your Claude subscription."
        ) from exc
    return claude_agent_sdk


def _allowed_tool_names(config: GraphConfig, role_name: str) -> list[str]:
    role = config.role(role_name)  # type: ignore[arg-type]
    enabled = set(role.tools)

    # Writing stays gated twice, exactly as on the API provider.
    if "write_file" in enabled and not (
        role_name == "action" and config.action_mode == "execute"
    ):
        enabled.discard("write_file")

    names: list[str] = []
    for tool in sorted(enabled):
        if not getattr(config.tools, tool, False):
            continue
        names.extend(TOOL_MAP.get(tool, []))
    return sorted(set(names))


class AgentSDKProvider(Provider):
    """Implements the same two primitives as `Provider`, over the Agent SDK."""

    def __init__(self, config: GraphConfig):
        super().__init__(config)
        self._sdk = _require_sdk()
        self._workspace = Path(config.tools.workspace).expanduser().resolve()

    @property
    def client(self):  # pragma: no cover - there is no HTTP client here
        raise RuntimeError("the Agent SDK provider does not use the HTTP client")

    # -- permission gate --------------------------------------------------

    def _permission_gate(self, allowed: list[str]) -> Callable:
        """Decide tool calls in code, so a headless run never waits on a prompt.

        This is also where the workspace sandbox is enforced: the harness would
        otherwise ask about paths outside the working directory, and asking is
        not an option with nobody watching.
        """
        sdk = self._sdk
        workspace = self._workspace
        permitted = set(allowed)

        async def can_use_tool(tool_name: str, tool_input: dict, context: Any):
            if tool_name not in permitted:
                return sdk.PermissionResultDeny(
                    message=f"{tool_name} is not available to this agent."
                )
            if tool_name in FILE_TOOLS:
                target = tool_input.get("file_path") or tool_input.get("path")
                if target:
                    try:
                        resolved = (workspace / target).expanduser().resolve()
                    except OSError:
                        return sdk.PermissionResultDeny(message="unreadable path")
                    if resolved != workspace and workspace not in resolved.parents:
                        return sdk.PermissionResultDeny(
                            message=f"path escapes the workspace root: {target}"
                        )
            return sdk.PermissionResultAllow()

        return can_use_tool

    def _options(
        self,
        *,
        role: RoleConfig,
        system: str,
        allowed: list[str],
        schema: Optional[dict] = None,
        max_turns: Optional[int] = None,
    ):
        sdk = self._sdk
        kwargs: dict[str, Any] = {
            "system_prompt": system,
            "model": role.model,
            "effort": role.effort,
            "allowed_tools": allowed,
            "disallowed_tools": [t for t in ALL_BUILTIN_TOOLS if t not in allowed],
            "can_use_tool": self._permission_gate(allowed),
            "cwd": str(self._workspace),
            # Leave the ambient environment out of it: without this the harness
            # would load the user's CLAUDE.md, settings and skills into every
            # agent, which is not what this graph's prompts describe.
            "setting_sources": None,
            "permission_mode": "default",
        }
        if schema is not None:
            kwargs["output_format"] = {"type": "json_schema", "schema": schema}
        if max_turns is not None:
            kwargs["max_turns"] = max_turns
        if role.thinking:
            kwargs["thinking"] = sdk.ThinkingConfigAdaptive()

        remaining = self.config.limits.max_cost_usd
        if remaining:
            kwargs["max_budget_usd"] = remaining
        return sdk.ClaudeAgentOptions(**kwargs)

    # -- running one query ------------------------------------------------

    async def _collect(self, prompt: str, options) -> dict:
        sdk = self._sdk
        text_parts: list[str] = []
        tool_calls: list[dict] = []
        result: dict[str, Any] = {
            "text": "", "structured": None, "usage": Usage(calls=1),
            "tool_calls": tool_calls, "stop_reason": "end_turn", "error": None,
        }

        async for message in sdk.query(prompt=prompt, options=options):
            if isinstance(message, sdk.AssistantMessage):
                if message.error:
                    result["error"] = message.error
                for block in message.content:
                    if isinstance(block, sdk.TextBlock):
                        text_parts.append(block.text)
                    elif isinstance(block, sdk.ToolUseBlock):
                        tool_calls.append({"name": block.name, "input": block.input})
                    elif isinstance(block, sdk.ServerToolUseBlock):
                        tool_calls.append({"name": block.name, "input": block.input})
            elif isinstance(message, sdk.ResultMessage):
                result["structured"] = message.structured_output
                result["stop_reason"] = message.stop_reason or "end_turn"
                if message.result:
                    text_parts.append(message.result)
                usage = Usage(calls=1)
                raw = message.usage or {}
                usage.input_tokens = raw.get("input_tokens", 0) or 0
                usage.output_tokens = raw.get("output_tokens", 0) or 0
                usage.cache_read_tokens = raw.get("cache_read_input_tokens", 0) or 0
                usage.cache_write_tokens = raw.get("cache_creation_input_tokens", 0) or 0
                usage.cost_usd = message.total_cost_usd or 0.0
                result["usage"] = usage
                if message.is_error:
                    result["error"] = (message.errors or ["unknown error"])[0]

        # `result` repeats the final assistant text, so keep the longest single
        # rendering rather than concatenating a duplicate.
        result["text"] = max(text_parts, key=len).strip() if text_parts else ""
        return result

    def _run(self, prompt: str, options) -> dict:
        """Bridge to the async SDK.

        LangGraph runs this graph synchronously, fanning parallel branches out
        across threads, so each call gets its own short-lived event loop.
        """
        return asyncio.run(self._collect(prompt, options))

    def _guard(self, outcome: dict) -> None:
        error = outcome.get("error")
        if not error:
            return
        if error == "authentication_failed":
            raise RuntimeError(
                "The Claude Code CLI is not authenticated. Run `claude setup-token` "
                "to sign in with your Claude subscription."
            )
        if error == "billing_error":
            raise RuntimeError(
                "Claude reported a billing error. The monthly Agent SDK credit may "
                "be spent; enable usage credits or wait for the next cycle."
            )
        if error == "rate_limit":
            raise RuntimeError("Rate limited by Claude. Try again shortly.")
        if outcome.get("stop_reason") == "refusal":
            raise ModelRefusal(None, str(error))
        raise RuntimeError(f"Agent SDK run failed: {error}")

    # -- primitives -------------------------------------------------------

    def call_json(
        self, *, role: RoleConfig, system: str, prompt: str, schema: dict,
        budget: Budget,
    ) -> tuple[dict, Usage]:
        budget.check()
        options = self._options(role=role, system=system, allowed=[],
                                schema=schema, max_turns=1)
        outcome = self._run(prompt, options)
        usage = outcome["usage"]
        budget.usage.add(usage)
        self._guard(outcome)

        structured = outcome["structured"]
        if isinstance(structured, str):
            structured = _parse_json(structured)
        if structured is None:
            structured = _parse_json(outcome["text"])
        return structured, usage

    def structure(self, **kwargs) -> tuple[dict, Usage]:
        return self.call_json(**kwargs)

    def call_agent(
        self, *, role: RoleConfig, system: str, prompt: str, tools: list[dict],
        executor: Callable[[str, dict], str], budget: Budget, max_iterations: int,
        on_event: Optional[Callable[[dict], None]] = None,
    ) -> AgentResult:
        budget.check()
        # `tools` and `executor` belong to the API provider's own loop; here the
        # harness owns the loop, so the tool set is expressed as an allowlist.
        allowed = _allowed_tool_names(self.config, self._role_name(role))
        options = self._options(role=role, system=system, allowed=allowed,
                                max_turns=max_iterations)
        outcome = self._run(prompt, options)
        usage = outcome["usage"]
        budget.usage.add(usage)
        self._guard(outcome)

        emit = on_event or (lambda _e: None)
        for call in outcome["tool_calls"]:
            emit({"type": "tool", "name": call["name"], "input": call.get("input")})

        return AgentResult(
            text=outcome["text"],
            sources=_sources_from(outcome["tool_calls"]),
            tool_calls=outcome["tool_calls"],
            usage=usage,
            stop_reason=outcome["stop_reason"],
        )

    def _role_name(self, role: RoleConfig) -> str:
        """Which stage a RoleConfig belongs to.

        One provider serves every stage, and stages run in parallel threads, so
        the allowlist is derived per call from the role object the node passed
        rather than held as state on the provider.
        """
        for name, candidate in self.config.roles.items():
            if candidate is role:
                return name
        return "research"  # the most restrictive tool set that still has tools


def _sources_from(tool_calls: list[dict]) -> list[dict]:
    """Best-effort source list from what the agent fetched.

    The harness does not hand back web-search result blocks the way the
    Messages API does, so URLs the agent visited are the closest equivalent.
    """
    sources = []
    seen = set()
    for call in tool_calls:
        url = (call.get("input") or {}).get("url")
        if url and url not in seen:
            seen.add(url)
            sources.append({"title": "", "url": url})
    return sources
