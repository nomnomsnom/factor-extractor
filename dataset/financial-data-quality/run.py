"""
Orchestrator. From the dataset folder, run all scanners and emit reports.

Usage (from snom/dataset/):
    python financial-data-quality/run.py
    python financial-data-quality/run.py --data-dir other_dataset/
    python financial-data-quality/run.py --out-dir reports/

If only ai_agent_dataset.zip is present (no extracted folder), run.py extracts
it next to the zip first.
"""

from __future__ import annotations
import argparse
import sys
import zipfile
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

# Make `scan/` importable when running this file directly.
sys.path.insert(0, str(Path(__file__).parent))

from scan import ashare, hkex, nasdaq, nyse, tse, cross_market, report


SCANNERS = (
    ("ashare", ashare.scan),
    ("hkex", hkex.scan),
    ("nasdaq", nasdaq.scan),
    ("nyse", nyse.scan),
    ("tse", tse.scan),
    ("cross_market", cross_market.scan),
)


def ensure_extracted(data_dir: Path) -> Path:
    """If data_dir is missing but ai_agent_dataset.zip exists alongside it, extract."""
    if data_dir.exists():
        return data_dir
    zip_candidate = data_dir.parent / "ai_agent_dataset.zip"
    if zip_candidate.exists():
        print(f"[run] extracting {zip_candidate.name} ...")
        with zipfile.ZipFile(zip_candidate, "r") as z:
            for member in z.namelist():
                if member.startswith("__MACOSX"):
                    continue
                z.extract(member, data_dir.parent)
        return data_dir
    raise FileNotFoundError(
        f"Dataset not found at {data_dir} and no ai_agent_dataset.zip alongside it."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Multi-market data quality scanner")
    parser.add_argument("--data-dir", default="ai_agent_dataset",
                        help="Path to extracted dataset folder (default: ai_agent_dataset)")
    parser.add_argument("--out-dir", default=".",
                        help="Where to write quality_report.{json,md} (default: cwd)")
    args = parser.parse_args()

    data_dir = ensure_extracted(Path(args.data_dir).resolve())
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[run] dataset: {data_dir}")
    print(f"[run] output : {out_dir}")
    print()

    results = []
    for name, fn in SCANNERS:
        print(f"  scanning {name:13s} ...", end=" ", flush=True)
        r = fn(data_dir)
        results.append(r)
        if r.error:
            print(f"ERROR: {r.error}")
        else:
            print(f"{r.files_scanned} files, {len(r.issues)} issues")

    rep = report.build(results)
    json_path = out_dir / "quality_report.json"
    md_path = out_dir / "quality_report.md"
    report.write_json(rep, json_path)
    report.write_markdown(rep, md_path)

    s = rep["summary"]
    print()
    print(f"[run] total: {s['total_issues']} issues "
          f"(critical={s['critical']} warning={s['warning']} info={s['info']})")
    print(f"[run] wrote {json_path.name} and {md_path.name} to {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())