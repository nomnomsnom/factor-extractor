"""Command line entry point.

    python -m agent_graph.cli "your task"
    python -m agent_graph.cli --config run.json --stream
    python -m agent_graph.cli --serve --port 8000
"""

from __future__ import annotations

import argparse
import json
import sys

from .config import GraphConfig
from .llm import has_credentials, has_subscription
from .runner import run, stream

_ICON = {"lead": "▣", "research": "◇", "worker": "◆", "compiler": "▤", "action": "▶"}


def _print_event(event: dict) -> None:
    kind = event.get("type")
    if kind == "agent":
        icon = _ICON.get(event.get("stage", ""), "•")
        status = event.get("status")
        marker = {"running": "…", "done": "✓", "error": "✗"}.get(status, " ")
        label = (event.get("label") or "")[:96]
        print(f" {icon} {marker} [{event.get('stage')}] {label}", file=sys.stderr)
        if status == "done" and event.get("summary"):
            print(f"      {event['summary'][:160]}", file=sys.stderr)
    elif kind == "stage":
        print(
            f" ── {event.get('stage')}: {event.get('status')} "
            f"({event.get('count', 0)} agents) {event.get('reason', '')}".rstrip(),
            file=sys.stderr,
        )
    elif kind == "tool":
        print(f"      tool {event.get('name')}", file=sys.stderr)


def build_config(args: argparse.Namespace) -> GraphConfig:
    payload: dict = {}
    if args.config:
        with open(args.config, encoding="utf-8") as handle:
            payload = json.load(handle)
    if args.task:
        payload["task"] = args.task
    if args.preset:
        payload["preset"] = args.preset
    if args.mock:
        payload["provider"] = "mock"
    if args.agent_sdk:
        payload["provider"] = "agent_sdk"
    if args.workspace:
        payload.setdefault("tools", {})["workspace"] = args.workspace
    if args.action_mode:
        payload["action_mode"] = args.action_mode
    return GraphConfig.model_validate(payload)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="agent_graph")
    parser.add_argument("task", nargs="?", help="the task to run")
    parser.add_argument("--config", help="JSON file with a full GraphConfig")
    parser.add_argument(
        "--preset", choices=["quick", "standard", "deep", "exhaustive"]
    )
    parser.add_argument("--action-mode", choices=["off", "propose", "execute"])
    parser.add_argument("--workspace", help="sandbox root for the file tools")
    # Contradictory together, so let argparse say so rather than having the
    # order they are applied in silently decide.
    providers = parser.add_mutually_exclusive_group()
    providers.add_argument("--mock", action="store_true",
                           help="run with the deterministic mock model")
    providers.add_argument("--agent-sdk", action="store_true",
                           help="run on your Claude subscription via the Agent "
                                "SDK instead of an API key")
    parser.add_argument("--stream", action="store_true",
                        help="print progress events to stderr")
    parser.add_argument("--json", action="store_true",
                        help="print the full result as JSON")
    parser.add_argument("--serve", action="store_true",
                        help="start the configuration UI instead of running")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args(argv)

    if args.serve:
        from .server import serve

        serve(host=args.host, port=args.port)
        return 0

    if not args.task and not args.config:
        parser.error("a task or --config is required (or use --serve)")

    config = build_config(args)
    if config.provider == "anthropic" and not has_credentials():
        hint = (
            "  --agent-sdk    run on your Claude subscription instead\n"
            if has_subscription() else
            "  pip install claude-agent-sdk && claude setup-token, then "
            "--agent-sdk to use a Claude subscription\n"
        )
        print(
            "No Anthropic API credentials found. Options:\n"
            "  ANTHROPIC_API_KEY=...   or `ant auth login`\n"
            + hint +
            "  --mock         dry run, no model calls",
            file=sys.stderr,
        )
        return 2
    if config.provider == "agent_sdk" and not has_subscription():
        print(
            "The Agent SDK route needs both halves:\n"
            "  pip install claude-agent-sdk\n"
            "  claude setup-token        (signs in with your Claude subscription)",
            file=sys.stderr,
        )
        return 2

    if args.stream:
        result = {}
        for event in stream(config):
            _print_event(event)
            if event.get("type") == "run" and "result" in event:
                result = event["result"]
    else:
        result = run(config)

    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        print(result.get("report", ""))
        critique = result.get("critique", {})
        if critique.get("caveats"):
            print("\n---\nCaveats:")
            for caveat in critique["caveats"]:
                print(f"- {caveat}")
        usage = result.get("usage", {})
        print(
            f"\n[{result.get('status')}] {usage.get('calls', 0)} model calls, "
            f"{usage.get('input_tokens', 0)} in / {usage.get('output_tokens', 0)} out, "
            f"{result.get('elapsed_seconds')}s",
            file=sys.stderr,
        )

    return 0 if result.get("status") == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
