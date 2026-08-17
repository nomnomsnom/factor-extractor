"""Graph assembly.

    START -> lead
             |  fan out (0..N)
             v
          research ... -> research_join
                              |  fan out (0..M)
                              v
                           worker ... -> worker_join
                                             |
                                             v
                                          compiler
                                          /   |   \
                              revise <---'    |    `---> action ... -> finish
                              (back to lead)  `-------------------------> finish

Every fan-out can be empty: the dispatcher returns the join node's name instead
of a list of `Send`s, and the stage is skipped entirely.
"""

from __future__ import annotations

from typing import Callable

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from .config import GraphConfig
from .llm import Budget, Provider
from .nodes import (
    make_action,
    make_compiler,
    make_lead,
    make_research,
    make_worker,
)
from .prompts import COVERAGE_SCORE
from .state import GraphState

Emit = Callable[[dict], None]


def build_graph(
    config: GraphConfig,
    provider: Provider,
    budget: Budget,
    emit: Emit,
):
    builder = StateGraph(GraphState)

    builder.add_node("lead", make_lead(config, provider, budget, emit))
    builder.add_node("research", make_research(config, provider, budget, emit))
    builder.add_node("research_join", _passthrough)
    builder.add_node("worker", make_worker(config, provider, budget, emit))
    builder.add_node("worker_join", _passthrough)
    builder.add_node("compiler", make_compiler(config, provider, budget, emit))
    builder.add_node("action", make_action(config, provider, budget, emit))
    builder.add_node("finish", _finish)

    builder.add_edge(START, "lead")

    builder.add_conditional_edges(
        "lead", _dispatch_research(emit), ["research", "research_join"]
    )
    builder.add_edge("research", "research_join")

    builder.add_conditional_edges(
        "research_join", _dispatch_workers(emit), ["worker", "worker_join"]
    )
    builder.add_edge("worker", "worker_join")

    builder.add_edge("worker_join", "compiler")

    builder.add_conditional_edges(
        "compiler", _route_after_compile(config, emit), ["lead", "action", "finish"]
    )
    builder.add_edge("action", "finish")
    builder.add_edge("finish", END)

    return builder.compile()


def _passthrough(state: dict) -> dict:
    return {}


def _finish(state: dict) -> dict:
    return {"status": "complete"}


def _dispatch_research(emit: Emit):
    def dispatch(state: dict):
        specs = state.get("plan", {}).get("research_tasks", [])
        if not specs:
            emit({"type": "stage", "stage": "research", "status": "skipped", "count": 0})
            return "research_join"
        emit({"type": "stage", "stage": "research", "status": "fanout",
              "count": len(specs),
              "agents": [{"id": s.get("id"), "label": s.get("question", "")}
                         for s in specs]})
        prior = state.get("findings", [])
        return [Send("research", {"spec": spec, "prior": prior}) for spec in specs]

    return dispatch


def _dispatch_workers(emit: Emit):
    def dispatch(state: dict):
        specs = state.get("plan", {}).get("worker_tasks", [])
        if not specs:
            emit({"type": "stage", "stage": "worker", "status": "skipped", "count": 0})
            return "worker_join"
        emit({"type": "stage", "stage": "worker", "status": "fanout",
              "count": len(specs),
              "agents": [{"id": s.get("id"), "label": s.get("instruction", "")[:120]}
                         for s in specs]})
        findings = state.get("findings", [])
        return [Send("worker", {"spec": spec, "findings": findings}) for spec in specs]

    return dispatch


def _route_after_compile(config: GraphConfig, emit: Emit):
    def route(state: dict):
        critique = state.get("critique", {})
        coverage = COVERAGE_SCORE.get(critique.get("coverage", ""), 0.5)
        rounds_used = state.get("round", 1)  # incremented by the compiler

        wants_more = bool(critique.get("needs_more_research"))
        has_questions = bool(critique.get("followup_questions"))
        under_bar = coverage < config.limits.quality_bar
        rounds_left = rounds_used < config.limits.max_rounds

        if wants_more and has_questions and under_bar and rounds_left:
            emit({
                "type": "stage", "stage": "revise", "status": "fanout",
                "count": 1,
                "reason": (
                    f"coverage {critique.get('coverage')} is below the "
                    f"{config.limits.quality_bar:.2f} bar; "
                    f"round {rounds_used + 1} of {config.limits.max_rounds}"
                ),
            })
            return "lead"

        specs = state.get("plan", {}).get("action_tasks", [])
        if config.action_mode != "off" and state.get("plan", {}).get("needs_action") \
                and specs:
            emit({"type": "stage", "stage": "action", "status": "fanout",
                  "count": len(specs),
                  "agents": [{"id": s.get("id"), "label": s.get("description", "")}
                             for s in specs]})
            report = state.get("report", "")
            return [Send("action", {"spec": spec, "report": report}) for spec in specs]

        emit({"type": "stage", "stage": "action", "status": "skipped", "count": 0})
        return "finish"

    return route


def recursion_limit(config: GraphConfig) -> int:
    """Six supersteps per round, plus headroom for the action stage."""
    return 6 * config.limits.max_rounds + 20
