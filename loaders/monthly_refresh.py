"""
monthly_refresh.py — Automation entry point.
Runs the full monthly pipeline, then emits the artifact wrapper JSON:
  1. 03_build_directory.py       (SEC bulk ticker/exchange directory)
  2. 02_load_sec_data.py         (universe facts + rolling 6-year window)
  3. export_dashboard_data.py    (rebuild frontend/data snapshot)
  4. git commit + push HEAD:main (publish snapshot -> Vercel redeploy)

The Blueprint runner imports this module and calls run(ctx).
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import mysql.connector

HERE = Path(r"C:\Users\co149\Documents\Kimi\Workspaces\PowerBi Dashboard\loaders")
REPO = HERE.parent
FRONTEND = REPO / "frontend"
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


def run_export():
    """Rebuild the frontend/data snapshot from finance_db."""
    proc = subprocess.run(
        [sys.executable, str(FRONTEND / "export_dashboard_data.py")],
        cwd=str(REPO), capture_output=True, text=True, timeout=900,
    )
    tail = (proc.stdout or "")[-2000:] + (proc.stderr or "")[-1000:]
    if proc.returncode != 0:
        raise RuntimeError(f"export_dashboard_data.py failed ({proc.returncode}): {tail}")
    return tail


def git(args, check=True):
    proc = subprocess.run(
        ["git", *args], cwd=str(REPO), capture_output=True, text=True, timeout=300,
    )
    if check and proc.returncode != 0:
        raise RuntimeError(
            f"git {' '.join(args)} failed ({proc.returncode}): "
            f"{(proc.stderr or '')[-1000:]}"
        )
    return proc


def publish_snapshot():
    """Commit frontend/data changes and fast-forward origin/main (Vercel)."""
    run_export()
    git(["add", "frontend/data"])
    if git(["diff", "--cached", "--quiet"], check=False).returncode == 0:
        return {
            "committed": False,
            "pushed": False,
            "detail": "No dashboard data changes; nothing to publish.",
        }
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    git(["commit", "-m", "chore(data): monthly dashboard snapshot refresh"])
    sha = git(["rev-parse", "--short", "HEAD"]).stdout.strip()
    push = git(["push", "origin", "HEAD:main"], check=False)
    if push.returncode != 0:
        raise RuntimeError(
            "git push origin HEAD:main failed (not a fast-forward?): "
            f"{(push.stderr or '')[-1000:]}"
        )
    return {
        "committed": True,
        "pushed": True,
        "detail": f"Published {sha} from {branch} to origin/main.",
    }


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
    publish = publish_snapshot()
    return {
        "summary": (
            f"Monthly refresh complete: {directory} directory companies, "
            f"{universe} universe companies with facts, "
            f"{facts} financial facts (rolling 6-year window). "
            + publish["detail"]
        ),
        "directory_companies": directory,
        "universe_with_facts": universe,
        "total_facts": facts,
        "snapshot_committed": publish["committed"],
        "snapshot_pushed": publish["pushed"],
        "publish_detail": publish["detail"],
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
