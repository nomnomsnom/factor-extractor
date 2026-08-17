"""Graph state.

Keys written by parallel branches (`findings`, `artifacts`, `actions`, `events`)
carry an additive reducer; everything else is written by exactly one node per
superstep.
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


class GraphState(TypedDict, total=False):
    # Set once, at the start of the run.
    task: str

    # Planning loop.
    round: int
    plan: dict
    critique: dict

    # Accumulated across rounds and across parallel agents.
    findings: Annotated[list[dict], operator.add]
    artifacts: Annotated[list[dict], operator.add]
    actions: Annotated[list[dict], operator.add]
    trace: Annotated[list[dict], operator.add]

    # Final output.
    report: str
    structured: Any
    status: str


def initial_state(task: str) -> GraphState:
    return {
        "task": task,
        "round": 0,
        "plan": {},
        "critique": {},
        "findings": [],
        "artifacts": [],
        "actions": [],
        "trace": [],
        "report": "",
        "status": "running",
    }
