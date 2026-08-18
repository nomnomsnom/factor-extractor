"""Tests for the Agent SDK provider.

The SDK is stubbed throughout: these assert on the options the provider builds
and the permission decisions it makes, which is where the interesting logic
lives. No Claude Code process is spawned and nothing touches the network.
"""

from __future__ import annotations

import asyncio
import sys
import types

import pytest

from agent_graph.config import GraphConfig
from agent_graph.llm import Budget


# ----------------------------------------------------------------- stubbing --


class _Block:
    pass


class TextBlock(_Block):
    def __init__(self, text):
        self.text = text


class ToolUseBlock(_Block):
    def __init__(self, name, input):
        self.name, self.input = name, input


class ServerToolUseBlock(_Block):
    def __init__(self, name, input):
        self.name, self.input = name, input


class ThinkingBlock(_Block):
    pass


class ToolResultBlock(_Block):
    pass


class ServerToolResultBlock(_Block):
    pass


class AssistantMessage:
    def __init__(self, content, error=None):
        self.content, self.error = content, error


class ResultMessage:
    def __init__(self, structured_output=None, result=None, usage=None,
                 total_cost_usd=0.0, is_error=False, errors=None,
                 stop_reason="end_turn"):
        self.structured_output = structured_output
        self.result = result
        self.usage = usage or {}
        self.total_cost_usd = total_cost_usd
        self.is_error = is_error
        self.errors = errors
        self.stop_reason = stop_reason


class ClaudeAgentOptions:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
        self._kwargs = kwargs


class ThinkingConfigAdaptive:
    pass


class PermissionResultAllow:
    def __init__(self, **kw):
        self.allowed = True


class PermissionResultDeny:
    def __init__(self, message=""):
        self.allowed, self.message = False, message


def _install_stub(monkeypatch, messages):
    """Put a fake `claude_agent_sdk` in sys.modules and capture the options."""
    captured = {}

    async def query(prompt, options):
        captured["prompt"] = prompt
        captured["options"] = options
        for message in messages:
            yield message

    stub = types.SimpleNamespace(
        query=query,
        AssistantMessage=AssistantMessage,
        ResultMessage=ResultMessage,
        TextBlock=TextBlock,
        ToolUseBlock=ToolUseBlock,
        ServerToolUseBlock=ServerToolUseBlock,
        ClaudeAgentOptions=ClaudeAgentOptions,
        ThinkingConfigAdaptive=ThinkingConfigAdaptive,
        PermissionResultAllow=PermissionResultAllow,
        PermissionResultDeny=PermissionResultDeny,
    )
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", stub)
    return captured


def _provider(monkeypatch, messages, **cfg):
    from agent_graph.agent_sdk import AgentSDKProvider

    captured = _install_stub(monkeypatch, messages)
    config = GraphConfig.model_validate({"task": "t", "provider": "agent_sdk", **cfg})
    return AgentSDKProvider(config), captured, config


# ------------------------------------------------------------------- options --


def test_call_json_asks_for_the_schema_and_no_tools(monkeypatch):
    provider, captured, config = _provider(
        monkeypatch,
        [ResultMessage(structured_output={"ok": True},
                       usage={"input_tokens": 10, "output_tokens": 4},
                       total_cost_usd=0.02)],
    )
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    data, usage = provider.call_json(
        role=config.role("lead"), system="sys", prompt="p",
        schema=schema, budget=Budget(max_calls=5),
    )

    assert data == {"ok": True}
    assert usage.cost_usd == 0.02
    options = captured["options"]
    assert options.output_format == {"type": "json_schema", "schema": schema}
    assert options.allowed_tools == []
    # An empty allowlist must not be readable as "anything goes".
    assert "Bash" in options.disallowed_tools
    assert options.setting_sources is None   # no ambient CLAUDE.md / settings
    assert options.effort == config.role("lead").effort


def test_research_role_gets_read_only_built_ins(monkeypatch):
    provider, captured, config = _provider(
        monkeypatch,
        [AssistantMessage([TextBlock("found it")]),
         ResultMessage(usage={"input_tokens": 5, "output_tokens": 2})],
    )
    provider.call_agent(
        role=config.role("research"), system="sys", prompt="p", tools=[],
        executor=lambda n, i: "", budget=Budget(max_calls=5), max_iterations=4,
    )
    allowed = captured["options"].allowed_tools
    assert "WebSearch" in allowed and "Read" in allowed
    assert "Write" not in allowed and "Bash" not in allowed


def test_write_needs_both_the_tool_and_execute_mode(monkeypatch):
    messages = [AssistantMessage([TextBlock("done")]), ResultMessage()]

    provider, captured, config = _provider(
        monkeypatch, messages, tools={"write_file": True}, action_mode="propose")
    provider.call_agent(role=config.role("action"), system="s", prompt="p",
                        tools=[], executor=lambda n, i: "",
                        budget=Budget(max_calls=5), max_iterations=2)
    assert "Write" not in captured["options"].allowed_tools

    provider, captured, config = _provider(
        monkeypatch, messages, tools={"write_file": True}, action_mode="execute")
    provider.call_agent(role=config.role("action"), system="s", prompt="p",
                        tools=[], executor=lambda n, i: "",
                        budget=Budget(max_calls=5), max_iterations=2)
    assert "Write" in captured["options"].allowed_tools


def test_role_lookup_is_per_call_not_shared_state(monkeypatch):
    """Stages run in parallel threads, so the allowlist must follow the role."""
    provider, captured, config = _provider(
        monkeypatch, [AssistantMessage([TextBlock("x")]), ResultMessage()])
    assert provider._role_name(config.role("worker")) == "worker"
    assert provider._role_name(config.role("action")) == "action"


# --------------------------------------------------------- permission gate --


def _decide(provider, allowed, tool, payload):
    gate = provider._permission_gate(allowed)
    return asyncio.run(gate(tool, payload, None))


def test_gate_denies_tools_outside_the_allowlist(monkeypatch):
    provider, _, _ = _provider(monkeypatch, [ResultMessage()])
    assert _decide(provider, ["Read"], "Bash", {"command": "ls"}).allowed is False
    assert _decide(provider, ["Read"], "Read", {"file_path": "a.txt"}).allowed is True


def test_gate_keeps_file_tools_inside_the_workspace(monkeypatch, tmp_path):
    (tmp_path / "inside.txt").write_text("x", encoding="utf-8")
    provider, _, _ = _provider(monkeypatch, [ResultMessage()],
                               tools={"workspace": str(tmp_path)})

    assert _decide(provider, ["Read"], "Read",
                   {"file_path": "inside.txt"}).allowed is True
    for escape in ["../secrets", "/etc/passwd", "a/../../out"]:
        decision = _decide(provider, ["Read"], "Read", {"file_path": escape})
        assert decision.allowed is False, f"should refuse {escape}"
        assert "workspace" in decision.message


def test_gate_never_returns_none(monkeypatch):
    """A None decision would leave the harness waiting on a prompt forever."""
    provider, _, _ = _provider(monkeypatch, [ResultMessage()])
    for tool, payload in [("Read", {}), ("WebSearch", {"query": "x"}),
                          ("Write", {"file_path": "a"})]:
        assert _decide(provider, ["Read", "WebSearch", "Write"], tool, payload) is not None


# --------------------------------------------------------------- failures ---


def test_authentication_failure_explains_the_fix(monkeypatch):
    provider, _, config = _provider(
        monkeypatch,
        [AssistantMessage([], error="authentication_failed"), ResultMessage()],
    )
    with pytest.raises(RuntimeError, match="claude setup-token"):
        provider.call_json(role=config.role("lead"), system="s", prompt="p",
                           schema={"type": "object"}, budget=Budget(max_calls=5))


def test_billing_failure_mentions_the_credit(monkeypatch):
    provider, _, config = _provider(
        monkeypatch,
        [AssistantMessage([], error="billing_error"), ResultMessage()],
    )
    with pytest.raises(RuntimeError, match="Agent SDK credit"):
        provider.call_json(role=config.role("lead"), system="s", prompt="p",
                           schema={"type": "object"}, budget=Budget(max_calls=5))


def test_budget_still_stops_the_run(monkeypatch):
    from agent_graph.llm import BudgetExceeded

    provider, _, config = _provider(monkeypatch, [ResultMessage()])
    budget = Budget(max_calls=1)
    budget.usage.calls = 1
    with pytest.raises(BudgetExceeded):
        provider.call_json(role=config.role("lead"), system="s", prompt="p",
                           schema={"type": "object"}, budget=budget)


def test_json_falls_back_to_parsing_the_text(monkeypatch):
    """structured_output is the happy path; text is the safety net."""
    provider, _, config = _provider(
        monkeypatch,
        [AssistantMessage([TextBlock('{"a": 1}')]), ResultMessage()],
    )
    data, _ = provider.call_json(role=config.role("lead"), system="s", prompt="p",
                                 schema={"type": "object"}, budget=Budget(max_calls=5))
    assert data == {"a": 1}


# ------------------------------------------------------------------ config --


def test_provider_is_selectable_and_detected():
    from agent_graph.llm import has_subscription

    config = GraphConfig.model_validate({"task": "t", "provider": "agent_sdk"})
    assert config.provider == "agent_sdk"
    assert isinstance(has_subscription(), bool)


def test_missing_sdk_gives_an_actionable_error(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "claude_agent_sdk":
            raise ImportError("no module")
        return real_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "claude_agent_sdk", raising=False)
    monkeypatch.setattr(builtins, "__import__", fake_import)

    from agent_graph.agent_sdk import AgentSDKProvider, AgentSDKUnavailable

    with pytest.raises(AgentSDKUnavailable, match="claude setup-token"):
        AgentSDKProvider(GraphConfig.model_validate({"task": "t"}))


# -------------------------------------------------------------- integration --


def test_whole_graph_runs_through_the_stubbed_sdk(monkeypatch):
    """End-to-end wiring check, including the async bridge.

    LangGraph fans parallel stages out across threads and this provider bridges
    to an async SDK with `asyncio.run` per call, so a real run exercises a fresh
    event loop in several threads at once. That is the part most likely to
    break, and it cannot be caught by testing the provider alone.
    """
    import json as _json
    import threading

    from agent_graph.graph import build_graph, recursion_limit
    from agent_graph.state import initial_state

    seen_threads: set[int] = set()
    plan = {
        "objective": "o", "task_type": "research", "complexity": 3,
        "success_criteria": ["c"],
        "research_tasks": [
            {"id": f"r{i}", "question": f"q{i}", "why": "w", "depth": "normal"}
            for i in range(3)
        ],
        "worker_tasks": [
            {"id": "w1", "instruction": "draft", "output_format": "prose",
             "needs_findings": True}
        ],
        "needs_action": False, "action_tasks": [], "reasoning": "because",
    }
    critique = {
        "deliverable": "# Done", "coverage": "complete", "unmet_criteria": [],
        "needs_more_research": False, "followup_questions": [], "caveats": [],
    }

    async def query(prompt, options):
        seen_threads.add(threading.get_ident())
        fmt = getattr(options, "output_format", None)
        if fmt:
            props = set(fmt["schema"].get("properties", {}))
            if "research_tasks" in props:
                payload = plan
            elif "needs_more_research" in props:
                payload = critique
            elif "key_points" in props:
                payload = {"summary": "s", "key_points": [], "confidence": "high",
                           "gaps": []}
            else:
                payload = {"output": "artifact", "notes": "", "assumptions": []}
            yield ResultMessage(structured_output=payload,
                                usage={"input_tokens": 3, "output_tokens": 1},
                                total_cost_usd=0.01)
            return
        yield AssistantMessage([TextBlock("agent said something")])
        yield ResultMessage(usage={"input_tokens": 3, "output_tokens": 1},
                            total_cost_usd=0.01)

    stub = types.SimpleNamespace(
        query=query, AssistantMessage=AssistantMessage, ResultMessage=ResultMessage,
        TextBlock=TextBlock, ToolUseBlock=ToolUseBlock,
        ServerToolUseBlock=ServerToolUseBlock, ClaudeAgentOptions=ClaudeAgentOptions,
        ThinkingConfigAdaptive=ThinkingConfigAdaptive,
        PermissionResultAllow=PermissionResultAllow,
        PermissionResultDeny=PermissionResultDeny,
    )
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", stub)

    from agent_graph.agent_sdk import AgentSDKProvider

    config = GraphConfig.model_validate(
        {"task": "t", "provider": "agent_sdk", "limits": {"max_rounds": 1}}
    )
    provider = AgentSDKProvider(config)
    budget = Budget(max_calls=config.limits.max_llm_calls)
    events: list[dict] = []
    graph = build_graph(config, provider, budget, events.append)

    state = graph.invoke(initial_state("t"), {"recursion_limit": recursion_limit(config)})

    assert state["status"] == "complete"
    assert len(state["findings"]) == 3
    assert len(state["artifacts"]) == 1
    assert state["report"] == "# Done"
    assert budget.usage.cost_usd > 0          # dollars flowed through
    assert len(seen_threads) > 1, "parallel stages should span threads"
