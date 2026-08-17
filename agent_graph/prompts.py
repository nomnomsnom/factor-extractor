"""System prompts and the JSON schemas that shape each stage's output.

Schemas obey the structured-output constraints: every object sets
`additionalProperties: false` and lists all of its properties in `required`.
Numeric ranges are not expressible, so bounded values use enums or are clamped
after the fact.
"""

from __future__ import annotations

import json

from .config import Deliverable, GraphConfig

# ---------------------------------------------------------------- schemas ---

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "objective": {
            "type": "string",
            "description": "The task restated as the outcome to deliver.",
        },
        "task_type": {
            "type": "string",
            "enum": [
                "research", "analysis", "synthesis", "template_fill",
                "build", "decision", "action",
            ],
        },
        "complexity": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
        "success_criteria": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Checkable conditions the finished work must meet.",
        },
        "research_tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "question": {
                        "type": "string",
                        "description": "One self-contained question, answerable alone.",
                    },
                    "why": {"type": "string"},
                    "depth": {"type": "string", "enum": ["shallow", "normal", "deep"]},
                },
                "required": ["id", "question", "why", "depth"],
                "additionalProperties": False,
            },
        },
        "worker_tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "instruction": {
                        "type": "string",
                        "description": "A complete brief; the worker sees no other context.",
                    },
                    "output_format": {"type": "string"},
                    "needs_findings": {"type": "boolean"},
                },
                "required": ["id", "instruction", "output_format", "needs_findings"],
                "additionalProperties": False,
            },
        },
        "needs_action": {"type": "boolean"},
        "action_tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "description": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": ["write_file", "compute", "summarize", "other"],
                    },
                },
                "required": ["id", "description", "kind"],
                "additionalProperties": False,
            },
        },
        "reasoning": {
            "type": "string",
            "description": "Why this shape of plan fits the task.",
        },
    },
    "required": [
        "objective", "task_type", "complexity", "success_criteria",
        "research_tasks", "worker_tasks", "needs_action", "action_tasks",
        "reasoning",
    ],
    "additionalProperties": False,
}

FINDING_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "gaps": {
            "type": "array",
            "items": {"type": "string"},
            "description": "What remains unanswered after this pass.",
        },
    },
    "required": ["summary", "key_points", "confidence", "gaps"],
    "additionalProperties": False,
}

ARTIFACT_SCHEMA = {
    "type": "object",
    "properties": {
        "output": {"type": "string"},
        "notes": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["output", "notes", "assumptions"],
    "additionalProperties": False,
}

COMPILE_SCHEMA = {
    "type": "object",
    "properties": {
        "deliverable": {
            "type": "string",
            "description": "The finished work, in the requested format.",
        },
        "coverage": {
            "type": "string",
            "enum": ["poor", "partial", "good", "complete"],
            "description": "How fully the success criteria are met.",
        },
        "unmet_criteria": {"type": "array", "items": {"type": "string"}},
        "needs_more_research": {"type": "boolean"},
        "followup_questions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Questions a further research round should answer.",
        },
        "caveats": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "deliverable", "coverage", "unmet_criteria", "needs_more_research",
        "followup_questions", "caveats",
    ],
    "additionalProperties": False,
}

ACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {
            "type": "string",
            "enum": ["executed", "proposed", "skipped", "failed"],
        },
        "detail": {"type": "string"},
        "artifacts": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["status", "detail", "artifacts"],
    "additionalProperties": False,
}

COVERAGE_SCORE = {"poor": 0.25, "partial": 0.55, "good": 0.82, "complete": 1.0}

# ---------------------------------------------------------------- prompts ---

_SHARED_VOICE = """
Write for a reader who did not watch you work. Lead with the outcome, then the
supporting detail. Be selective about what you include rather than compressing
the writing into fragments — readable beats terse. Report faithfully: say what
you could not establish rather than papering over it, and don't claim work you
did not do.
""".strip()

LEAD_SYSTEM = f"""
You are the lead agent of a multi-agent graph. You do not do the work yourself;
you decide what work to commission.

The graph runs in stages: your research agents fan out in parallel, then your
worker agents fan out in parallel with the research findings in hand, then a
compiler agent assembles the deliverable, then optional action agents act on it.
Any stage may have zero agents.

Plan for the task in front of you, not for a template:

- A question you can answer from what you already have needs no research agents
  at all. Commission research when the answer depends on information not present
  in the conversation, or when a claim needs a source.
- Research agents gather and report. Worker agents transform: drafting sections,
  filling templates, computing, restructuring, writing code. A task that is pure
  retrieval needs no workers; a task that is pure transformation of supplied
  material needs no researchers.
- Every task you write is read by an agent that sees nothing else — not this
  plan, not the user's original wording, not its sibling tasks. Each brief must
  carry its own context, constraints, and the shape of the answer you want back.
- Split along genuinely independent lines. Two agents covering the same ground
  cost twice and return the same thing.
- Success criteria are how the compiler judges whether the work is done. Write
  them so that meeting them is checkable, not a matter of taste.

Scale the number of agents to the task's real complexity, and stay within the
ceilings you are given. A small task with two research agents beats the same
task with eight.

{_SHARED_VOICE}
""".strip()

RESEARCH_SYSTEM = f"""
You are a research agent. You own exactly one question and nothing else.

Search, read, and gather until you can answer it, then report what you found.
Ground each substantive claim in something you actually read — a source URL or a
file path — and say plainly when you could not establish something rather than
inferring it. Distinguish what a source states from what you concluded from it.

You are one of several agents working in parallel; another agent will combine
your report with theirs. Answer your question completely and do not speculate
about the wider task.

{_SHARED_VOICE}
""".strip()

WORKER_SYSTEM = f"""
You are a worker agent. You have one instruction and you carry it out.

Produce the artifact you were asked for, in the format you were asked for.
Research findings, when supplied, are your evidence — use them and stay
consistent with them. Where a finding is thin or contradicts another, say so in
your notes rather than smoothing it over.

Deliver what was asked at the scope intended. Make routine judgment calls
yourself and record them as assumptions; don't widen the task, and don't leave
placeholders where real content belongs.

{_SHARED_VOICE}
""".strip()

COMPILER_SYSTEM = f"""
You are the compiler agent. Everything the graph produced arrives here, and you
turn it into the single deliverable the user asked for.

Your job is assembly and judgment, not fresh research:

- Reconcile the inputs. Where two agents disagree, resolve it if the evidence
  allows and flag it if it does not.
- Write the deliverable so it stands alone. A reader should never need the
  intermediate findings to make sense of it, and should never see the graph's
  internal machinery — task ids, agent names, stage labels.
- Then assess your own output against the success criteria honestly. Coverage is
  a report on the work, not on your effort: if criteria are unmet, name them.
- Ask for another research round only when specific, answerable questions would
  change the deliverable. Wanting more detail in general is not a reason.

{_SHARED_VOICE}
""".strip()

ACTION_SYSTEM = f"""
You are an action agent. The deliverable is finished; you act on it.

You carry out exactly one action. Check that what you are about to do matches
what was asked before you do it, and confine every effect to your workspace.

In propose mode you do not execute anything: describe precisely what you would
do — the exact paths, the exact content — and report status "proposed". In
execute mode you carry the action out with your tools and report what actually
happened, including failures.

{_SHARED_VOICE}
""".strip()


# Hoisted so the browser build can reuse the exact wording rather than keeping
# its own copy (see tools/bundle.py).
DELIVERABLE_FORMATS = {
    "report": "A structured prose report with headings. Depth over breadth.",
    "brief": "A short brief: the answer up front, then the reasoning that supports it.",
    "bullets": "A bulleted summary. Every bullet a complete, standalone statement.",
    "json": "A single JSON object and nothing else — no prose, no code fences.",
    "template": "The supplied template with every placeholder filled in. Preserve its structure and wording exactly; replace only the placeholders.",
    "code": "Working code with a brief note on how to run it. No placeholder bodies.",
    "custom": "Follow the format instructions below.",
}


def deliverable_brief(deliverable: Deliverable) -> str:
    """Render the deliverable spec into instructions for the compiler."""
    parts: list[str] = []
    fmt = deliverable.format

    described = DELIVERABLE_FORMATS
    parts.append(f"Format: {described.get(fmt, described['report'])}")

    if deliverable.audience:
        parts.append(f"Audience: {deliverable.audience}")
    if fmt == "template" and deliverable.template:
        parts.append("Template to fill:\n---\n" + deliverable.template + "\n---")
    if fmt == "json" and deliverable.json_schema:
        parts.append(
            "The JSON must satisfy this schema:\n"
            + json.dumps(deliverable.json_schema, indent=2)
        )
    if deliverable.instructions:
        parts.append("Format instructions: " + deliverable.instructions)

    return "\n\n".join(parts)


def lead_prompt(config: GraphConfig, state: dict) -> str:
    limits = config.limits
    round_no = state.get("round", 0)

    sections = [
        f"# Task\n{config.task}",
    ]
    if config.context:
        sections.append(f"# Supplied context\n{config.context}")

    sections.append(
        "# Deliverable\n" + deliverable_brief(config.deliverable)
    )
    sections.append(
        "# Ceilings for this round\n"
        f"- research agents: at most {limits.max_research_agents}\n"
        f"- worker agents: at most {limits.max_worker_agents}\n"
        f"- action agents: at most {limits.max_action_agents}\n"
        f"- action mode: {config.action_mode}"
        + (
            "  (action agents are disabled; set needs_action to false)"
            if config.action_mode == "off"
            else ""
        )
    )

    if round_no == 0:
        sections.append(
            "This is the first round. Plan the work from scratch."
        )
    else:
        sections.append(
            f"# Round {round_no + 1} — gap filling\n"
            "A first pass already ran. Commission only the work that closes the "
            "gaps below; do not re-commission anything already answered.\n\n"
            "## What the compiler found missing\n"
            + _bullets(state.get("critique", {}).get("unmet_criteria", []))
            + "\n\n## Open questions\n"
            + _bullets(state.get("critique", {}).get("followup_questions", []))
            + "\n\n## Already established\n"
            + _findings_digest(state.get("findings", []))
        )

    return "\n\n".join(sections)


def research_prompt(spec: dict, config: GraphConfig, prior: list[dict]) -> str:
    sections = [
        f"# Your question\n{spec['question']}",
        f"# Why it matters\n{spec.get('why', '(not stated)')}",
        f"# Depth\n{spec.get('depth', 'normal')}",
    ]
    if config.context:
        sections.append(f"# Context supplied with the task\n{config.context}")
    if prior:
        sections.append(
            "# Already established by earlier agents\n"
            "Do not re-derive these; build on them.\n\n" + _findings_digest(prior)
        )
    sections.append(
        "Report your findings as prose. Cite a URL or file path for each "
        "substantive claim, and end with anything you could not resolve."
    )
    return "\n\n".join(sections)


def worker_prompt(spec: dict, config: GraphConfig, findings: list[dict]) -> str:
    sections = [f"# Your instruction\n{spec['instruction']}"]
    sections.append(f"# Required output format\n{spec.get('output_format', 'prose')}")
    if config.context:
        sections.append(f"# Context supplied with the task\n{config.context}")
    if spec.get("needs_findings", True) and findings:
        sections.append("# Research findings\n" + _findings_digest(findings, full=True))
    elif spec.get("needs_findings", True):
        sections.append(
            "# Research findings\nNone were gathered. Work from the instruction "
            "and context, and record what you assumed."
        )
    return "\n\n".join(sections)


def compile_prompt(config: GraphConfig, state: dict) -> str:
    plan = state.get("plan", {})
    sections = [
        f"# Objective\n{plan.get('objective') or config.task}",
        "# Success criteria\n" + _bullets(plan.get("success_criteria", [])),
        "# Deliverable specification\n" + deliverable_brief(config.deliverable),
    ]
    if config.context:
        sections.append(f"# Context supplied with the task\n{config.context}")

    findings = state.get("findings", [])
    artifacts = state.get("artifacts", [])
    sections.append(
        "# Research findings\n"
        + (_findings_digest(findings, full=True) if findings
           else "None — no research agents ran.")
    )
    sections.append(
        "# Worker artifacts\n"
        + (_artifacts_digest(artifacts) if artifacts
           else "None — no worker agents ran.")
    )

    rounds_left = config.limits.max_rounds - state.get("round", 0) - 1
    if rounds_left <= 0:
        sections.append(
            "This is the final round — no further research is possible. Set "
            "needs_more_research to false and record anything still missing as "
            "caveats."
        )
    else:
        sections.append(
            f"{rounds_left} further research round(s) are available if specific "
            "answerable questions would change the deliverable."
        )
    return "\n\n".join(sections)


def action_prompt(spec: dict, config: GraphConfig, report: str) -> str:
    return "\n\n".join(
        [
            f"# Your action\n{spec['description']}",
            f"# Kind\n{spec.get('kind', 'other')}",
            f"# Mode\n{config.action_mode}",
            f"# Workspace root\n{config.tools.workspace}",
            "# The finished deliverable\n" + report,
        ]
    )


# ---------------------------------------------------------------- helpers ---


def _bullets(items: list) -> str:
    if not items:
        return "(none)"
    return "\n".join(f"- {item}" for item in items)


def _findings_digest(findings: list[dict], full: bool = False) -> str:
    if not findings:
        return "(none)"
    chunks = []
    for finding in findings:
        lines = [f"### {finding.get('question', finding.get('id', 'finding'))}"]
        lines.append(f"Confidence: {finding.get('confidence', 'unknown')}")
        lines.append(finding.get("summary", ""))
        if full:
            points = finding.get("key_points") or []
            if points:
                lines.append(_bullets(points))
            sources = finding.get("sources") or []
            if sources:
                lines.append(
                    "Sources: "
                    + "; ".join(
                        f"{s.get('title') or s.get('url')} <{s.get('url', '')}>"
                        for s in sources[:10]
                    )
                )
        gaps = finding.get("gaps") or []
        if gaps:
            lines.append("Unresolved: " + "; ".join(gaps))
        chunks.append("\n".join(line for line in lines if line))
    return "\n\n".join(chunks)


def _artifacts_digest(artifacts: list[dict]) -> str:
    if not artifacts:
        return "(none)"
    chunks = []
    for artifact in artifacts:
        lines = [f"### {artifact.get('instruction', artifact.get('id', 'artifact'))}"]
        lines.append(artifact.get("output", ""))
        notes = artifact.get("notes")
        if notes:
            lines.append(f"Worker notes: {notes}")
        assumptions = artifact.get("assumptions") or []
        if assumptions:
            lines.append("Assumptions: " + "; ".join(assumptions))
        chunks.append("\n".join(line for line in lines if line))
    return "\n\n".join(chunks)
