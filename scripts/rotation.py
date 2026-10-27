#!/usr/bin/env python3
"""Keep track of when each country profile was last checked.

  python3 scripts/rotation.py next 20        print the 20 least recently checked countries
  python3 scripts/rotation.py mark KEN FRA   mark countries as checked today
  python3 scripts/rotation.py status         summary of how stale the profiles are
"""
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
PATH = ROOT / "content" / "rotation.yaml"
TENURE = ROOT / "content" / "tenure.yaml"


def load():
    ids = sorted((yaml.safe_load(TENURE.read_text()) or {}).keys())
    data = (yaml.safe_load(PATH.read_text()) or {}) if PATH.exists() else {}
    return {cid: str(data.get(cid, "2000-01-01")) for cid in ids}


def save(data):
    lines = ["# Last date each country profile was checked by the daily update (see UPDATING.md).",
             "# Managed by scripts/rotation.py."]
    lines += [f"{cid}: '{d}'" for cid, d in sorted(data.items())]
    PATH.write_text("\n".join(lines) + "\n")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    data = load()
    cmd = sys.argv[1]
    if cmd == "next":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        for cid, d in sorted(data.items(), key=lambda kv: (kv[1], kv[0]))[:n]:
            print(cid, d)
    elif cmd == "mark":
        today = date.today().isoformat()
        for cid in sys.argv[2:]:
            if cid not in data:
                sys.exit(f"unknown country code {cid}")
            data[cid] = today
        save(data)
        print(f"marked {len(sys.argv) - 2} as checked on {today}")
    elif cmd == "status":
        today = date.today()
        ages = sorted((today - date.fromisoformat(d)).days for d in data.values())
        print(f"{len(ages)} countries; oldest check {ages[-1]} days ago; median {ages[len(ages) // 2]} days")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
