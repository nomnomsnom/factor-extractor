"""Pack the UI into one self-contained HTML file.

Output: ``dist/agent-graph.html`` — a standalone page with no imports, no
stylesheet links and no backend. Everything the served app gets from
``/api/schema`` is baked in at build time by importing the real modules, so the
published page cannot drift from ``config.py`` and ``prompts.py``.

The page still reaches the network for one thing and one thing only: the
visitor's own calls to ``api.anthropic.com``. A Content-Security-Policy pins
that down, so even a script injected into the page could not send the key
anywhere else.

Usage: python -m agent_graph.tools.bundle
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from agent_graph import prompts
from agent_graph.config import (
    MODEL_CHOICES,
    PRESETS,
    ROLES,
    Deliverable,
    GraphConfig,
)

UI = Path(__file__).resolve().parent / "ui"
DIST = Path(__file__).resolve().parent / "dist"

# The browser has no filesystem, so the file tools simply do not exist there.
BROWSER_TOOLS = {"server": ["web_search", "web_fetch"], "local": ["calculator"]}

# Non-streaming requests cannot safely ask for more than this (see engine.js).
BROWSER_TOKEN_CAP = 16000

CSP = (
    "default-src 'none'; "
    "style-src 'unsafe-inline'; "
    "script-src 'unsafe-inline'; "
    "img-src data:; "
    "connect-src https://api.anthropic.com; "
    "base-uri 'none'; "
    "form-action 'none'"
)


def browser_defaults() -> dict:
    """The served app's defaults, trimmed to what a browser can actually do."""
    config = GraphConfig().model_dump(mode="json")

    tools = config["tools"]
    for name in ("read_file", "list_dir", "write_file"):
        tools[name] = False
    tools.pop("workspace", None)

    allowed = set(BROWSER_TOOLS["server"]) | set(BROWSER_TOOLS["local"])
    for role in config["roles"].values():
        role["tools"] = [tool for tool in role["tools"] if tool in allowed]
        role["max_tokens"] = min(role["max_tokens"], BROWSER_TOKEN_CAP)

    # Nothing can be written, so acting is limited to describing the action.
    config["action_mode"] = "propose"
    config["tools"]["workspace"] = "."
    return config


def schema_payload() -> dict:
    """Mirrors the server's /api/schema, minus what the browser cannot do."""
    return {
        "models": MODEL_CHOICES,
        "roles": list(ROLES),
        "presets": PRESETS,
        "tools": BROWSER_TOOLS,
        "efforts": ["low", "medium", "high", "xhigh", "max"],
        "formats": list(prompts.DELIVERABLE_FORMATS),
        "action_modes": ["off", "propose"],
        "defaults": browser_defaults(),
        "credentials": False,
        "token_cap": BROWSER_TOKEN_CAP,
    }


def prompts_payload() -> dict:
    """The system prompts and schemas, lifted straight out of prompts.py."""
    return {
        "LEAD_SYSTEM": prompts.LEAD_SYSTEM,
        "RESEARCH_SYSTEM": prompts.RESEARCH_SYSTEM,
        "WORKER_SYSTEM": prompts.WORKER_SYSTEM,
        "COMPILER_SYSTEM": prompts.COMPILER_SYSTEM,
        "ACTION_SYSTEM": prompts.ACTION_SYSTEM,
        "PLAN_SCHEMA": prompts.PLAN_SCHEMA,
        "FINDING_SCHEMA": prompts.FINDING_SCHEMA,
        "ARTIFACT_SCHEMA": prompts.ARTIFACT_SCHEMA,
        "COMPILE_SCHEMA": prompts.COMPILE_SCHEMA,
        "ACTION_SCHEMA": prompts.ACTION_SCHEMA,
        "deliverable_formats": prompts.DELIVERABLE_FORMATS,
    }


def build() -> str:
    html = (UI / "index.html").read_text(encoding="utf-8")

    body_match = re.search(r"<body>(.*)</body>", html, re.DOTALL)
    if not body_match:
        raise SystemExit("index.html: no <body> found")
    # Drop the script tags; their sources are inlined below in the same order.
    body = re.sub(
        r'\s*<script src="/static/[^"]+"></script>', "", body_match.group(1)
    ).strip()

    title = re.search(r"<title>([^<]*)</title>", html).group(1)
    favicon = re.search(r'<link rel="icon" href="([^"]*)"', html).group(1)

    # `</script>` inside a JSON string would close the tag early.
    injected = json.dumps(
        {"schema": schema_payload(), "prompts": prompts_payload()},
        ensure_ascii=False,
    ).replace("</", "<\\/")

    scripts = "\n".join(
        (UI / name).read_text(encoding="utf-8")
        for name in ("simulate.js", "engine.js", "app.js")
    )

    page = f"""<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<title>{title}</title>
<meta name="description" content="Configure and run a multi-agent Claude graph: a lead agent plans, research and worker agents fan out in parallel, a compiler assembles the deliverable. Runs in your browser with your own API key.">
<link rel="icon" href="{favicon}">
<style>
{(UI / 'styles.css').read_text(encoding='utf-8').strip()}
</style>
</head>
<body>
{body}

<script>window.__AGENT_GRAPH_STATIC__ = {injected};</script>
<script>
{scripts}
</script>
</body>
</html>
"""

    DIST.mkdir(parents=True, exist_ok=True)
    out = DIST / "agent-graph.html"
    out.write_text(page, encoding="utf-8")
    return page


def main() -> int:
    page = build()
    # A stray reference to the served app's paths would 404 on a static host.
    leftovers = re.findall(r'(?:src|href)="/(?:static|api)/[^"]*"', page)
    if leftovers:
        print(f"bundle still references the server: {leftovers}", file=sys.stderr)
        return 1
    print(f"dist/agent-graph.html  {len(page) / 1024:.0f} KB  (standalone)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
