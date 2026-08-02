"""
monthly_refresh.py — Automation entry point.
Runs the two loaders in sequence, then emits the artifact wrapper JSON:
  1. 03_build_directory.py  (SEC bulk ticker/exchange directory)
  2. 02_load_sec_data.py    (universe facts + rolling 6-year window)

The Blueprint runner imports this module and calls run(ctx).
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import mysql.connector

HERE = Path(r"C:\Users\co149\Documents\Kimi\Workspaces\PowerBi Dashboard\loaders")
CFG = json.loads((HERE / "db_config.json").read_text())
DB = {k: CFG[k] for k in ("host", "port", "user", "password", "database")}


def run_loader(script):
    proc = subprocess.run(
        [sys.executable, str(HERE / script)],
        cwd=str(HERE), capture_output=True, text=True, timeout=2100,
    )
    tail = (proc.stdout or "")[-2000:] + (proc.stderr or "")[-1000:]
    if proc.returncode != 0:
        raise RuntimeError(f"{script} failed ({proc.returncode}): {tail}")
    return tail


def counts():
    conn = mysql.connector.connect(**DB)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM companies")
    directory = cur.fetchone()[0]
    cur.execute(
        "SELECT COUNT(*) FROM companies "
        "WHERE in_fact_universe = 1 AND has_facts = 1")
    universe = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM financial_facts")
    facts = cur.fetchone()[0]
    cur.close()
    conn.close()
    return directory, universe, facts


def build_artifact():
    run_loader("03_build_directory.py")
    run_loader("02_load_sec_data.py")
    directory, universe, facts = counts()
    return {
        "summary": (
            f"Monthly refresh complete: {directory} directory companies, "
            f"{universe} universe companies with facts, "
            f"{facts} financial facts (rolling 6-year window)."
        ),
        "directory_companies": directory,
        "universe_with_facts": universe,
        "total_facts": facts,
    }


def run(ctx):
    """Blueprint runner entry point (called with a context dict)."""
    payload = json.dumps({"artifact": build_artifact()})
    out_file = os.environ.get("DAIMON_BLUEPRINT_AUTOMATION_OUTPUT_FILE")
    if out_file:
        Path(out_file).write_text(payload, encoding="utf-8")
    print(payload)


def main():
    run({})


if __name__ == "__main__":
    main()
