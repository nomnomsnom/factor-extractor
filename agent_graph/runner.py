"""Run the graph.

`run()` executes to completion and returns the result. `stream()` runs the graph
on a worker thread and yields events as they happen, which is what the HTTP
server hands to the browser.
"""

from __future__ import annotations

import queue
import threading
import time
import traceback
from typing import Callable, Iterator, Optional

from .config import GraphConfig
from .graph import build_graph, recursion_limit
from .llm import Budget, BudgetExceeded, ModelRefusal, Provider
from .mock import MockProvider
from .state import initial_state

_SENTINEL = object()


def make_provider(config: GraphConfig) -> Provider:
    if config.provider == "mock":
        return MockProvider(config)
    if config.provider == "agent_sdk":
        from .agent_sdk import AgentSDKProvider

        return AgentSDKProvider(config)
    return Provider(config)


def run(
    config: GraphConfig,
    on_event: Optional[Callable[[dict], None]] = None,
) -> dict:
    """Execute the graph and return a result dict."""
    emit = on_event or (lambda _e: None)
    provider = make_provider(config)
    budget = Budget(max_calls=config.limits.max_llm_calls)
    graph = build_graph(config, provider, budget, emit)

    started = time.time()
    emit({"type": "run", "status": "started", "at": started,
          "config": config.model_dump(mode="json")})

    state = initial_state(config.task)
    status = "complete"
    error = None

    try:
        state = graph.invoke(
            state, {"recursion_limit": recursion_limit(config)}
        )
    except BudgetExceeded as exc:
        status, error = "budget_exceeded", str(exc)
    except ModelRefusal as exc:
        status, error = "refused", str(exc)
    except Exception as exc:
        status, error = "error", f"{type(exc).__name__}: {exc}"
        emit({"type": "log", "level": "error", "message": traceback.format_exc()})

    result = {
        "status": status,
        "error": error,
        "report": state.get("report", ""),
        "structured": state.get("structured"),
        "plan": state.get("plan", {}),
        "critique": state.get("critique", {}),
        "findings": state.get("findings", []),
        "artifacts": state.get("artifacts", []),
        "actions": state.get("actions", []),
        "rounds": state.get("round", 0),
        "usage": budget.usage.as_dict(),
        "elapsed_seconds": round(time.time() - started, 2),
    }
    emit({"type": "run", "status": status, "result": result})
    return result


def stream(config: GraphConfig) -> Iterator[dict]:
    """Yield events while the graph runs on a background thread."""
    events: "queue.Queue" = queue.Queue()

    def worker() -> None:
        try:
            run(config, on_event=events.put)
        except Exception as exc:  # run() already handles most failures
            events.put({"type": "run", "status": "error",
                        "error": f"{type(exc).__name__}: {exc}"})
        finally:
            events.put(_SENTINEL)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    while True:
        event = events.get()
        if event is _SENTINEL:
            break
        yield event
    thread.join(timeout=5)
