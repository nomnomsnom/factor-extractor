"""
Report assembly: turn a list of ScanResult objects into:
  - quality_report.json (machine-readable, all fields)
  - quality_report.md  (human-readable, grouped by severity)
"""

from __future__ import annotations
from datetime import datetime
from pathlib import Path
import json

from .common import ScanResult, issues_as_dicts


def build(results: list[ScanResult]) -> dict:
    all_issues = [i for r in results for i in r.issues]
    by_sev = {"critical": [], "warning": [], "info": []}
    for i in all_issues:
        by_sev[i.severity].append(i)

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
        },
        "issues": issues_as_dicts(all_issues),
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