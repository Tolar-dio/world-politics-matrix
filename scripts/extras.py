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

    return {"per_country": per_country}
