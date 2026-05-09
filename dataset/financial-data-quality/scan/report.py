"""
Report assembly: turn a list of ScanResult objects into:
  - quality_report.json (machine-readable, all fields)
  - quality_report.md  (human-readable, grouped by severity)

Markdown layout:
  1. Summary line (counts by severity)
  2. Issues by category (compact crosstab so the reviewer can skim)
  3. Cascading findings (issues that share (symbol, date) — usually a single
     root cause cross-validated across multiple checks)
  4. Per-severity sections with the full issue list
"""

from __future__ import annotations
from collections import defaultdict
from datetime import datetime
from pathlib import Path
import json

from .common import ScanResult, issues_as_dicts


SEVERITY_ORDER = ("critical", "warning", "info")


def _category_crosstab(issues: list[dict]) -> dict[str, dict[str, int]]:
    """{category: {severity: count, ..., 'total': N}}, ordered by total desc."""
    counts: dict[str, dict[str, int]] = defaultdict(
        lambda: {"critical": 0, "warning": 0, "info": 0, "total": 0}
    )
    for i in issues:
        c = counts[i["category"]]
        c[i["severity"]] += 1
        c["total"] += 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]["total"]))


def _normalize_date(s: str) -> str:
    """Strip trailing time/zone so ISO ('2025-10-15T00:00:00Z') and plain
    ('2025-10-15') form the same group key."""
    s = s.strip()
    if "T" in s:
        s = s.split("T", 1)[0]
    if " " in s:
        s = s.split(" ", 1)[0]
    return s


def _split_symbols(s: str) -> list[str]:
    """Cross-market issues store symbols like '601318 / 2318.HK' — split so
    each underlying symbol gets credited in its own cascade bucket."""
    parts = []
    for chunk in s.replace(",", "/").split("/"):
        c = chunk.strip()
        if c and c.lower() not in {"all", "multiple", "n/a"}:
            parts.append(c)
    return parts


def _cascade_groups(issues: list[dict]) -> list[dict]:
    """Group issues that share (symbol, date), excluding ALL/multiple keys.
    Two or more independent checks firing on the same (symbol, date) is
    almost always a single root-cause bug cross-validated by multiple
    detectors — surface it explicitly so the reviewer sees the cascade."""
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for i in issues:
        symbols = _split_symbols(i.get("symbol") or "")
        date = _normalize_date(i.get("date") or "")
        if not symbols or not date:
            continue
        if date.lower() in {"all", "multiple", "n/a"}:
            continue
        for sym in symbols:
            buckets[(sym, date)].append(i)
    groups = []
    for (sym, date), members in buckets.items():
        if len(members) >= 2:
            groups.append({"symbol": sym, "date": date, "issues": members})
    # rank: more members first, then critical-heavy first
    groups.sort(key=lambda g: (-len(g["issues"]),
                               -sum(1 for x in g["issues"] if x["severity"] == "critical")))
    return groups


def build(results: list[ScanResult]) -> dict:
    all_issues = [i for r in results for i in r.issues]
    by_sev = {"critical": [], "warning": [], "info": []}
    for i in all_issues:
        by_sev[i.severity].append(i)

    issue_dicts = issues_as_dicts(all_issues)
    return {
        "scan_timestamp": datetime.now().isoformat(timespec="seconds"),
        "summary": {
            "total_issues": len(all_issues),
            "critical": len(by_sev["critical"]),
            "warning": len(by_sev["warning"]),
            "info": len(by_sev["info"]),
            "markets_scanned": [r.market for r in results],
            "files_scanned_total": sum(r.files_scanned for r in results),
            "files_scanned_by_market": {r.market: r.files_scanned for r in results},
            "by_category": _category_crosstab(issue_dicts),
        },
        "issues": issue_dicts,
        "cascading_findings": _cascade_groups(issue_dicts),
        "scan_errors": {r.market: r.error for r in results if r.error},
    }


def write_json(report: dict, path: Path) -> None:
    Path(path).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")


def write_markdown(report: dict, path: Path) -> None:
    s = report["summary"]
    lines: list[str] = []
    lines.append("# Financial Data Quality Report")
    lines.append("")
    lines.append(f"_Generated {report['scan_timestamp']}_")
    lines.append("")
    lines.append(f"- Total issues: **{s['total_issues']}** "
                 f"(critical {s['critical']} / warning {s['warning']} / info {s['info']})")
    lines.append(f"- Markets: {', '.join(s['markets_scanned'])}")
    lines.append(f"- Files scanned: {s['files_scanned_total']} "
                 f"({', '.join(f'{m}={n}' for m, n in s['files_scanned_by_market'].items())})")
    lines.append("")

    if report["scan_errors"]:
        lines.append("## Scanner errors")
        for m, e in report["scan_errors"].items():
            lines.append(f"- **{m}**: {e}")
        lines.append("")

    by_cat = s.get("by_category", {})
    if by_cat:
        lines.append("## Issues by category")
        lines.append("")
        lines.append("| Category | Critical | Warning | Info | Total |")
        lines.append("|---|---:|---:|---:|---:|")
        for cat, c in by_cat.items():
            lines.append(f"| {cat} | {c['critical']} | {c['warning']} | {c['info']} | {c['total']} |")
        lines.append("")

    cascades = report.get("cascading_findings", [])
    if cascades:
        lines.append("## Cascading findings")
        lines.append("")
        lines.append("Two or more independent checks fired on the same `(symbol, date)`. "
                     "Each group below is one root-cause bug cross-validated by multiple "
                     "detectors — strong evidence the underlying data is broken, not just "
                     "noise from a single noisy check.")
        lines.append("")
        for n, g in enumerate(cascades, 1):
            sev_breakdown = ", ".join(
                f"{sum(1 for x in g['issues'] if x['severity'] == sv)} {sv}"
                for sv in SEVERITY_ORDER
                if sum(1 for x in g["issues"] if x["severity"] == sv) > 0
            )
            lines.append(f"### Group #{n} — {g['symbol']} on {g['date']} "
                         f"({len(g['issues'])} issues: {sev_breakdown})")
            for x in g["issues"]:
                lines.append(f"- *{x['severity']}* `{x['category']}` "
                             f"({x['market']} / {x['document']}): {x['description']}")
            lines.append("")

    for sev_label, sev_key in [("Critical", "critical"), ("Warning", "warning"), ("Info", "info")]:
        rows = [i for i in report["issues"] if i["severity"] == sev_key]
        if not rows:
            continue
        lines.append(f"## {sev_label} ({len(rows)})")
        lines.append("")
        for n, i in enumerate(rows, 1):
            lines.append(f"### {sev_label} #{n} — {i['market']} / {i['category']}")
            lines.append(f"- **Symbol:** {i['symbol']}")
            lines.append(f"- **Date:** {i['date']}")
            lines.append(f"- **Document:** {i['document']}")
            lines.append(f"- **Issue:** {i['description']}")
            lines.append(f"- **Recommended fix:** {i['recommended_fix']}")
            lines.append("")

    Path(path).write_text("\n".join(lines), encoding="utf-8")