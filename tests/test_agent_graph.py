"""Tests for the agent graph.

Everything here runs against the mock provider, so no API key or network is
needed. The point is to pin down the topology and the guardrails: zero-agent
stages, the revision loop, the budget ceiling, and the filesystem sandbox.
"""

from __future__ import annotations

import json

import pytest

from agent_graph.config import PRESETS, GraphConfig
from agent_graph.graph import build_graph, recursion_limit
from agent_graph.llm import Budget, BudgetExceeded, _parse_json
from agent_graph.mock import MockProvider
from agent_graph.runner import run
from agent_graph.state import initial_state
from agent_graph.tools import Workspace, build_toolset, calculate, server_tool_specs


def config(**overrides) -> GraphConfig:
    payload = {"task": "test task", "provider": "mock"}
    payload.update(overrides)
    return GraphConfig.model_validate(payload)


# ------------------------------------------------------------------ config --


def test_preset_seeds_limits_and_effort():
    quick = config(preset="quick")
    deep = config(preset="deep")
    assert quick.effort == "low"
    assert deep.effort == "high"
    assert deep.limits.max_research_agents > quick.limits.max_research_agents


def test_explicit_limits_merge_into_the_preset():
    cfg = config(preset="deep", limits={"max_research_agents": 1})
    assert cfg.limits.max_research_agents == 1
    assert cfg.effort == "high"  # still seeded from the preset
    # Untouched limits keep the preset's values rather than falling back to the
    # field defaults.
    assert cfg.limits.max_rounds == PRESETS["deep"]["limits"]["max_rounds"]
    assert cfg.limits.max_llm_calls == PRESETS["deep"]["limits"]["max_llm_calls"]


def test_roles_inherit_effort_and_default_tools():
    cfg = config(preset="deep")
    assert cfg.role("research").effort == "high"
    assert cfg.role("lead").tools == []  # the planner has no tools
    assert "web_search" in cfg.role("research").tools
    # Research agents never get write access even when the tool is enabled.
    cfg = config(tools={"write_file": True})
    assert "write_file" not in cfg.role("research").tools
    assert "write_file" in cfg.role("action").tools


# ------------------------------------------------------------------- tools --


def test_workspace_rejects_escapes(tmp_path):
    (tmp_path / "inside.txt").write_text("hello", encoding="utf-8")
    workspace = Workspace(str(tmp_path))

    assert "hello" in workspace.read_file("inside.txt")
    for escape in ["../etc/passwd", "/etc/passwd", "sub/../../outside.txt"]:
        with pytest.raises(ValueError):
            workspace.read_file(escape)


def test_workspace_write_and_list(tmp_path):
    workspace = Workspace(str(tmp_path))
    workspace.write_file("nested/note.md", "content")
    assert "nested/" in workspace.list_dir(".")
    assert "content" in workspace.read_file("nested/note.md")


def test_calculator_is_arithmetic_only():
    assert calculate("(1250 * 0.07) / 12").startswith("7.29")
    for hostile in ["__import__('os').system('ls')", "open('/etc/passwd')", "2**9999"]:
        with pytest.raises(Exception):
            calculate(hostile)


def test_write_tool_is_gated_by_action_mode():
    cfg = config(tools={"write_file": True}, action_mode="propose")
    specs, _ = build_toolset(cfg, "action", "claude-opus-5")
    assert not any(s.get("name") == "write_file" for s in specs)

    cfg = config(tools={"write_file": True}, action_mode="execute")
    specs, _ = build_toolset(cfg, "action", "claude-opus-5")
    assert any(s.get("name") == "write_file" for s in specs)


def test_server_tool_version_tracks_the_model():
    modern = server_tool_specs(["web_search"], "claude-opus-5", 5)
    legacy = server_tool_specs(["web_search"], "claude-haiku-4-5", 5)
    assert modern[0]["type"] == "web_search_20260209"
    assert legacy[0]["type"] == "web_search_20250305"


def test_executor_refuses_tools_the_role_does_not_have(tmp_path):
    cfg = config(tools={"workspace": str(tmp_path), "write_file": False})
    _, executor = build_toolset(cfg, "research", "claude-opus-5")
    with pytest.raises(ValueError):
        executor("write_file", {"path": "x", "content": "y"})


# --------------------------------------------------------------- topology --


def _run_graph(cfg: GraphConfig) -> dict:
    events: list[dict] = []
    provider = MockProvider(cfg)
    budget = Budget(max_calls=cfg.limits.max_llm_calls)
    graph = build_graph(cfg, provider, budget, events.append)
    state = graph.invoke(initial_state(cfg.task),
                         {"recursion_limit": recursion_limit(cfg)})
    return {"state": state, "events": events}


def test_zero_research_agents_skips_the_stage():
    cfg = config(limits={"max_research_agents": 0, "max_rounds": 1})
    out = _run_graph(cfg)
    assert out["state"]["findings"] == []
    assert out["state"]["report"]
    skipped = [e for e in out["events"]
               if e.get("type") == "stage" and e.get("stage") == "research"]
    assert skipped and skipped[0]["status"] == "skipped"


def test_zero_workers_still_compiles():
    cfg = config(limits={"max_worker_agents": 0, "max_rounds": 1})
    out = _run_graph(cfg)
    assert out["state"]["artifacts"] == []
    assert out["state"]["report"]


def test_every_stage_can_be_empty():
    cfg = config(
        action_mode="off",
        limits={"max_research_agents": 0, "max_worker_agents": 0, "max_rounds": 1},
    )
    out = _run_graph(cfg)
    state = out["state"]
    assert (state["findings"], state["artifacts"], state["actions"]) == ([], [], [])
    assert state["status"] == "complete"


def test_fan_out_respects_the_ceiling():
    cfg = config(limits={"max_research_agents": 2, "max_rounds": 1})
    out = _run_graph(cfg)
    # The mock plans 3; the lead clamps to 2.
    assert len(out["state"]["findings"]) == 2


def test_revision_loop_runs_and_terminates():
    cfg = config(limits={"max_rounds": 3, "quality_bar": 0.9})
    out = _run_graph(cfg)
    lead_runs = [e for e in out["events"]
                 if e.get("stage") == "lead" and e.get("status") == "done"]
    assert len(lead_runs) == 2  # the mock asks for exactly one extra round
    assert out["state"]["round"] == 2


def test_single_round_config_never_revises():
    cfg = config(limits={"max_rounds": 1})
    out = _run_graph(cfg)
    lead_runs = [e for e in out["events"]
                 if e.get("stage") == "lead" and e.get("status") == "done"]
    assert len(lead_runs) == 1


def test_action_mode_off_disables_the_action_stage():
    cfg = config(action_mode="off", limits={"max_rounds": 1})
    out = _run_graph(cfg)
    assert out["state"]["actions"] == []
    assert out["state"]["plan"]["needs_action"] is False


def test_action_agents_run_in_propose_mode():
    cfg = config(action_mode="propose", limits={"max_rounds": 1})
    out = _run_graph(cfg)
    assert len(out["state"]["actions"]) == 1
    assert out["state"]["actions"][0]["mode"] == "propose"


# ----------------------------------------------------------------- budget --


def test_budget_stops_the_run():
    cfg = config(limits={"max_llm_calls": 3})
    result = run(cfg)
    assert result["status"] == "budget_exceeded"
    assert result["usage"]["calls"] <= 4  # the failing call is counted


def test_budget_raises_once_exhausted():
    budget = Budget(max_calls=1)
    budget.usage.calls = 1
    with pytest.raises(BudgetExceeded):
        budget.check()


# ----------------------------------------------------------------- runner --


def test_run_returns_a_complete_result():
    result = run(config(limits={"max_rounds": 1}))
    assert result["status"] == "complete"
    assert result["report"]
    assert result["usage"]["calls"] > 0
    assert result["elapsed_seconds"] >= 0
    assert set(result) >= {"plan", "critique", "findings", "artifacts", "actions"}


def test_run_emits_events_for_every_stage():
    seen: list[dict] = []
    run(config(limits={"max_rounds": 1}), on_event=seen.append)
    stages = {e.get("stage") for e in seen if e.get("type") == "agent"}
    assert {"lead", "research", "worker", "compiler"} <= stages
    assert seen[0]["type"] == "run" and seen[0]["status"] == "started"
    assert seen[-1]["type"] == "run" and seen[-1]["status"] == "complete"


def test_json_deliverable_is_conformed_to_the_schema():
    schema = {
        "type": "object",
        "properties": {"headline": {"type": "string"},
                       "score": {"type": "integer"}},
        "required": ["headline", "score"],
        "additionalProperties": False,
    }
    result = run(config(
        limits={"max_rounds": 1},
        deliverable={"format": "json", "json_schema": schema},
    ))
    assert set(result["structured"]) == {"headline", "score"}
    assert json.loads(result["report"]) == result["structured"]


# ------------------------------------------------------------------- misc --


def test_parse_json_handles_fences_and_prose():
    assert _parse_json('{"a": 1}') == {"a": 1}
    assert _parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert _parse_json('Here you go:\n{"a": 1}\nHope that helps.') == {"a": 1}
    with pytest.raises(ValueError):
        _parse_json("no json here")


def test_recursion_limit_scales_with_rounds():
    assert recursion_limit(config(limits={"max_rounds": 5})) > \
           recursion_limit(config(limits={"max_rounds": 1}))


# ----------------------------------------------- live request construction --
# No API key is available here, so these assert on the request kwargs the
# provider builds rather than on a round trip.


class _Recorder:
    """Stands in for anthropic.Anthropic and captures the request."""

    def __init__(self, stop_reason="end_turn", text='{"ok": true}'):
        self.calls: list[dict] = []
        self._stop_reason = stop_reason
        self._text = text
        outer = self

        class _Block:
            type = "text"
            text = outer._text
            citations = None

        class _Response:
            content = [_Block()]
            stop_reason = outer._stop_reason
            stop_details = None
            usage = type("U", (), {
                "input_tokens": 10, "output_tokens": 5,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                "server_tool_use": None,
            })()

        class _Messages:
            @staticmethod
            def create(**kwargs):
                outer.calls.append(kwargs)
                return _Response()

        self.messages = _Messages()


def _provider_with(recorder, **cfg_overrides):
    from agent_graph.llm import Provider

    cfg = GraphConfig.model_validate({"task": "t", **cfg_overrides})
    provider = Provider(cfg)
    provider._client = recorder
    return provider, cfg


def test_request_never_sends_sampling_parameters():
    recorder = _Recorder()
    provider, cfg = _provider_with(recorder)
    provider.call_json(
        role=cfg.role("lead"), system="s", prompt="p",
        schema={"type": "object", "properties": {}, "additionalProperties": False},
        budget=Budget(max_calls=5),
    )
    sent = recorder.calls[0]
    # Opus 5 / Sonnet 5 reject these outright.
    assert not {"temperature", "top_p", "top_k"} & set(sent)
    assert sent["thinking"] == {"type": "adaptive"}
    assert sent["output_config"]["effort"] == cfg.effort
    assert sent["output_config"]["format"]["type"] == "json_schema"


def test_disabled_thinking_is_promoted_above_high_effort():
    from agent_graph.llm import _thinking_param
    from agent_graph.config import RoleConfig

    off_low = RoleConfig(model="claude-opus-5", thinking=False, effort="high")
    off_max = RoleConfig(model="claude-opus-5", thinking=False, effort="xhigh")
    assert _thinking_param(off_low) == {"type": "disabled"}
    # `disabled` + xhigh/max is a 400, so it falls back to adaptive.
    assert _thinking_param(off_max) == {"type": "adaptive"}


def test_fable_receives_no_thinking_parameter():
    from agent_graph.llm import _thinking_param
    from agent_graph.config import RoleConfig

    assert _thinking_param(RoleConfig(model="claude-fable-5")) is None


def test_prompt_caching_wraps_the_system_prompt():
    recorder = _Recorder()
    provider, cfg = _provider_with(recorder, prompt_caching=True)
    provider.call_json(
        role=cfg.role("lead"), system="stable prompt", prompt="p",
        schema={"type": "object", "properties": {}, "additionalProperties": False},
        budget=Budget(max_calls=5),
    )
    system = recorder.calls[0]["system"]
    assert system[0]["cache_control"] == {"type": "ephemeral"}

    recorder = _Recorder()
    provider, cfg = _provider_with(recorder, prompt_caching=False)
    provider.call_json(
        role=cfg.role("lead"), system="stable prompt", prompt="p",
        schema={"type": "object", "properties": {}, "additionalProperties": False},
        budget=Budget(max_calls=5),
    )
    assert recorder.calls[0]["system"] == "stable prompt"


def test_agent_loop_runs_local_tools_and_returns_results():
    """A tool_use turn, then an end_turn: the executor's output must go back."""
    from agent_graph.llm import Provider

    class _ToolBlock:
        type = "tool_use"
        id = "toolu_1"
        name = "calculator"
        input = {"expression": "2+2"}

    class _TextBlock:
        type = "text"
        text = "the answer is 4"
        citations = None

    usage = type("U", (), {
        "input_tokens": 1, "output_tokens": 1, "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0, "server_tool_use": None,
    })

    class _Client:
        def __init__(self):
            self.calls = []
            outer = self

            class _Messages:
                @staticmethod
                def create(**kwargs):
                    outer.calls.append(kwargs)
                    turn = len(outer.calls)
                    return type("R", (), {
                        "content": [_ToolBlock()] if turn == 1 else [_TextBlock()],
                        "stop_reason": "tool_use" if turn == 1 else "end_turn",
                        "stop_details": None,
                        "usage": usage(),
                    })()

            self.messages = _Messages()

    cfg = GraphConfig.model_validate({"task": "t"})
    provider = Provider(cfg)
    client = _Client()
    provider._client = client

    specs, executor = build_toolset(cfg, "research", "claude-opus-5")
    result = provider.call_agent(
        role=cfg.role("research"), system="s", prompt="p", tools=specs,
        executor=executor, budget=Budget(max_calls=5), max_iterations=4,
    )
    assert result.text == "the answer is 4"
    assert result.tool_calls[0]["output"] == "4"
    # The second request must carry the assistant turn and the tool result.
    second = client.calls[1]["messages"]
    assert second[-1]["content"][0]["tool_use_id"] == "toolu_1"
    assert second[-1]["content"][0]["content"] == "4"


def test_tool_errors_return_to_the_model_instead_of_raising():
    from agent_graph.llm import Provider

    class _ToolBlock:
        type = "tool_use"
        id = "toolu_1"
        name = "calculator"
        input = {"expression": "__import__('os')"}

    class _TextBlock:
        type = "text"
        text = "recovered"
        citations = None

    usage = type("U", (), {
        "input_tokens": 1, "output_tokens": 1, "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0, "server_tool_use": None,
    })

    class _Client:
        def __init__(self):
            self.calls = []
            outer = self

            class _Messages:
                @staticmethod
                def create(**kwargs):
                    outer.calls.append(kwargs)
                    turn = len(outer.calls)
                    return type("R", (), {
                        "content": [_ToolBlock()] if turn == 1 else [_TextBlock()],
                        "stop_reason": "tool_use" if turn == 1 else "end_turn",
                        "stop_details": None,
                        "usage": usage(),
                    })()

            self.messages = _Messages()

    cfg = GraphConfig.model_validate({"task": "t"})
    provider = Provider(cfg)
    client = _Client()
    provider._client = client
    specs, executor = build_toolset(cfg, "research", "claude-opus-5")

    result = provider.call_agent(
        role=cfg.role("research"), system="s", prompt="p", tools=specs,
        executor=executor, budget=Budget(max_calls=5), max_iterations=4,
    )
    assert result.text == "recovered"
    assert result.tool_calls[0]["error"] is True
    assert client.calls[1]["messages"][-1]["content"][0]["is_error"] is True


def test_refusal_is_surfaced_not_swallowed():
    from agent_graph.llm import ModelRefusal, Provider

    class _Client:
        class messages:
            @staticmethod
            def create(**kwargs):
                return type("R", (), {
                    "content": [],
                    "stop_reason": "refusal",
                    "stop_details": type("D", (), {"category": "cyber",
                                                   "explanation": "declined"})(),
                    "usage": type("U", (), {
                        "input_tokens": 1, "output_tokens": 0,
                        "cache_read_input_tokens": 0,
                        "cache_creation_input_tokens": 0,
                        "server_tool_use": None,
                    })(),
                })()

    cfg = GraphConfig.model_validate({"task": "t"})
    provider = Provider(cfg)
    provider._client = _Client()
    with pytest.raises(ModelRefusal):
        provider.call_json(
            role=cfg.role("lead"), system="s", prompt="p",
            schema={"type": "object", "properties": {}, "additionalProperties": False},
            budget=Budget(max_calls=5),
        )


def test_large_max_tokens_uses_streaming():
    """Non-streaming requests above ~16K output can hit the SDK's HTTP timeout."""
    from agent_graph.llm import Provider

    class _Stream:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        @staticmethod
        def get_final_message():
            return type("R", (), {
                "content": [type("B", (), {"type": "text", "text": "{}",
                                           "citations": None})()],
                "stop_reason": "end_turn",
                "stop_details": None,
                "usage": type("U", (), {
                    "input_tokens": 1, "output_tokens": 1,
                    "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                    "server_tool_use": None,
                })(),
            })()

    used = {"stream": False, "create": False}

    class _Client:
        class messages:
            @staticmethod
            def stream(**kwargs):
                used["stream"] = True
                return _Stream()

            @staticmethod
            def create(**kwargs):
                used["create"] = True
                return _Stream.get_final_message()

    cfg = GraphConfig.model_validate(
        {"task": "t", "roles": {"lead": {"max_tokens": 64000}}}
    )
    provider = Provider(cfg)
    provider._client = _Client()
    schema = {"type": "object", "properties": {}, "additionalProperties": False}
    provider.call_json(role=cfg.role("lead"), system="s", prompt="p",
                       schema=schema, budget=Budget(max_calls=5))
    assert used["stream"] and not used["create"]
