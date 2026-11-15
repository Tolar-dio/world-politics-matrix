"""Build the site's extra layers: indicators, storylines, forecasts, corrections, and the
per-country people, history, voice and connection sections.

Called from build.py. Each content file is optional; a missing file just means that
layer is empty. Raises BuildError on malformed content so a bad daily edit fails loudly.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import yaml


class BuildError(Exception):
    pass


ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _load_yaml(path: Path):
    if not path.exists():
        return None
    try:
        return yaml.safe_load(path.read_text()) or None
    except yaml.YAMLError as err:
        raise BuildError(f"{path.relative_to(path.parents[1])}: {err}")


def _load_dir(folder: Path) -> dict:
    """Merge every YAML file in a folder into one {ISO3: entry} map."""
    out: dict = {}
    if not folder.exists():
        return out
    for f in sorted(folder.glob("*.yaml")):
        data = _load_yaml(f) or {}
        if not isinstance(data, dict):
            raise BuildError(f"{f.name}: expected a mapping of country codes")
        for k, v in data.items():
            if k in out:
                raise BuildError(f"{f.name}: {k} appears in more than one file")
            out[k] = v
    return out


def _sources(lst, where: str) -> list[dict]:
    out = []
    for s in lst or []:
        if not isinstance(s, dict) or not s.get("url", "").startswith("http"):
            raise BuildError(f"{where}: every source needs a label and an http(s) url")
        out.append({"label": str(s.get("label") or s["url"]), "url": s["url"]})
    return out


def build(content: Path, data: Path, ids: set[str], md, paras, pretty_date) -> dict:
    """Write global extra files and return {ISO3: {section: payload}} for country details."""
    per_country: dict[str, dict] = {cid: {} for cid in ids}

    # Indicators: fetched by scripts/indicators.py, copied through untouched.
    ind = content / "indicators.json"
    if ind.exists():
        (data / "indicators.json").write_text(ind.read_text())

    # Corrections log.
    corr = _load_yaml(content / "corrections.yaml") or {}
    out = []
    for c in corr.get("corrections") or []:
        where = f"corrections.yaml: {c.get('what')}"
        if not ISO_DATE.match(str(c.get("date") or "")) or not c.get("what"):
            raise BuildError(f"{where}: needs a YYYY-MM-DD date and a 'what'")
        w = c.get("where") or {}
        out.append({
            "date": str(c["date"]), "pretty": pretty_date(str(c["date"])),
            "type": w.get("type") or "", "id": str(w.get("id") or ""),
            "what": str(c["what"]), "was": md(str(c.get("was") or ""))[0], "now": md(str(c.get("now") or ""))[0],
            "why": md(str(c.get("why") or ""))[0], "sources": _sources(c.get("sources"), where),
        })
    out.sort(key=lambda x: x["date"], reverse=True)
    (data / "corrections.json").write_text(json.dumps({"corrections": out}, ensure_ascii=False, separators=(",", ":")))
    for c in out:
        if c["type"] == "country" and c["id"] in per_country:
            per_country[c["id"]].setdefault("corrections", []).append({"date": c["pretty"], "what": c["what"]})

    # When each profile was last checked by the daily rotation.
    rot = _load_yaml(content / "rotation.yaml") or {}
    for cid, d in rot.items():
        if cid in per_country and d:
            per_country[cid]["checked"] = pretty_date(str(d))

    return {"per_country": per_country}
