#!/usr/bin/env python3
"""Daily snapshots for the time machine.

The build calls snapshot_today() after writing data/. Each snapshot records, for one day,
who led each country, its storyline tag, its war level, each conflict's state and the
drawn front lines. Snapshots live in data/history/YYYY-MM-DD.json and are never rewritten
once their day has passed, so the site keeps a record of how the world changed.

Run directly to backfill days missing from the git history:
    python3 scripts/history.py --backfill
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
HIST = DATA / "history"


def compact(index: dict, mil: dict | None) -> dict:
    snap = {"leaders": {}, "story": {}, "war": {}, "conflicts": {}, "lines": {}}
    for e in index.get("entities", []):
        if e.get("kind") != "country":
            continue
        cid = e["id"]
        snap["leaders"][cid] = [e.get("leader"), e.get("since")]
        if e.get("story"):
            snap["story"][cid] = e["story"]
        if e.get("war"):
            snap["war"][cid] = e["war"]
    for c in (mil or {}).get("conflicts", []):
        snap["conflicts"][c["id"]] = [c["intensity"], c["status"], c.get("updated"), c["name"]]
        lines = [[ln.get("name", ""), ln["points"]] for ln in c.get("lines", [])]
        if lines:
            snap["lines"][c["id"]] = lines
    return snap


def write(day: str, snap: dict, overwrite: bool) -> bool:
    HIST.mkdir(parents=True, exist_ok=True)
    path = HIST / f"{day}.json"
    if path.exists() and not overwrite:
        return False
    path.write_text(json.dumps({"date": day, **snap}, ensure_ascii=False, separators=(",", ":")))
    return True


def write_index() -> None:
    days = sorted(p.stem for p in HIST.glob("20*.json"))
    (HIST / "index.json").write_text(json.dumps({"days": days}, separators=(",", ":")))


def snapshot_today() -> None:
    index = json.loads((DATA / "index.json").read_text())
    mil_path = DATA / "military.json"
    mil = json.loads(mil_path.read_text()) if mil_path.exists() else None
    # Today's file is rewritten on every build of the day; earlier days are frozen.
    write(date.today().isoformat(), compact(index, mil), overwrite=True)
    write_index()


def git_show(rev: str, path: str):
    try:
        out = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=ROOT, check=True, capture_output=True).stdout
        return json.loads(out)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None


def backfill() -> None:
    log = subprocess.run(["git", "log", "--format=%H %cs", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    last_of_day: dict[str, str] = {}
    for line in log.splitlines():
        sha, day = line.split()
        last_of_day.setdefault(day, sha)  # log is newest first, so the first seen is the day's last commit
    made = 0
    for day, sha in sorted(last_of_day.items()):
        if day >= date.today().isoformat():
            continue
        index = git_show(sha, "data/index.json")
        if not index:
            continue
        if write(day, compact(index, git_show(sha, "data/military.json")), overwrite=False):
            made += 1
    write_index()
    print(f"history: backfilled {made} days")


if __name__ == "__main__":
    if "--backfill" in sys.argv:
        backfill()
    else:
        snapshot_today()
