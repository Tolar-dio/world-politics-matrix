"""Compile the conflict, battle, base and news content into site data.

Inputs (all optional, the build works without them):
  content/military/*.yaml   each with `conflicts:` and/or `battles:` lists
  content/bases.yaml        `bases:` list
  content/news.yaml         `news:`, `upcoming:` lists

Outputs:
  data/military.json        light data for the globe: conflicts (zones, lines), battles, bases
  data/conflicts/<id>.json  full conflict write-ups with their battles
  data/news.json            the news page feed
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import yaml

CONFLICT_TYPES = {"interstate", "civil-war", "insurgency", "intercommunal", "criminal",
                  "border-clash", "air-missile-campaign"}
INTENSITY = {"high": 3, "medium": 2, "low": 1}
STATUS = {"active", "fragile-ceasefire", "frozen"}
BASE_KINDS = {"air", "naval", "army", "joint", "missile", "nuclear", "space-intel",
              "logistics", "chokepoint", "contested-feature"}
TIERS = {"critical", "important", "notable"}
NEWS_CATS = {"military", "political", "diplomatic", "economic", "humanitarian"}


class BuildError(Exception):
    pass


def _need(obj: dict, keys: list[str], where: str) -> None:
    missing = [k for k in keys if obj.get(k) in (None, "", [])]
    if missing:
        raise BuildError(f"{where}: missing {', '.join(missing)}")


def _num(v, where: str, lo: float, hi: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise BuildError(f"{where}: not a number: {v!r}")
    if not lo <= f <= hi:
        raise BuildError(f"{where}: {f} out of range")
    return round(f, 4)


def _iso(v) -> str:
    return str(v) if v is not None else ""


def _sources(lst, where: str) -> list[dict]:
    out, seen = [], set()
    for s in lst or []:
        if not isinstance(s, dict) or not str(s.get("url", "")).startswith("http"):
            continue
        if s["url"] in seen:
            continue
        seen.add(s["url"])
        out.append({"label": str(s.get("label") or s["url"]), "url": str(s["url"])})
    return out


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def build(content: Path, data: Path, ids: set[str], md, paras, pretty_date) -> dict:
    """Returns {'by_country': {ISO3: [{id, name, intensity}]}, 'war': {ISO3: intensity}}."""
    text = lambda s: md(" ".join(str(s).split()))[0] if s else ""

    conflicts: dict[str, dict] = {}
    battles: list[dict] = []
    for path in sorted((content / "military").glob("*.yaml")):
        doc = yaml.safe_load(path.read_text()) or {}
        for c in doc.get("conflicts") or []:
            where = f"{path.name}: conflict {c.get('id')}"
            _need(c, ["id", "name", "type", "intensity", "status", "countries", "summary"], where)
            if c["id"] in conflicts:
                raise BuildError(f"{where}: duplicate id")
            if c["type"] not in CONFLICT_TYPES:
                raise BuildError(f"{where}: unknown type {c['type']}")
            if c["intensity"] not in INTENSITY:
                raise BuildError(f"{where}: unknown intensity {c['intensity']}")
            if c["status"] not in STATUS:
                raise BuildError(f"{where}: unknown status {c['status']}")
            bad = [x for x in c["countries"] if x not in ids]
            if bad:
                raise BuildError(f"{where}: unknown countries {bad}")
            c["_file"] = path.name
            conflicts[c["id"]] = c
        for b in doc.get("battles") or []:
            b["_file"] = path.name
            battles.append(b)

    # ---------- battles ----------
    seen_b = set()
    clean_battles = []
    for b in battles:
        where = f"{b['_file']}: battle {b.get('id')}"
        _need(b, ["id", "name", "conflict", "tier", "start", "lat", "lng"], where)
        if b["conflict"] not in conflicts:
            raise BuildError(f"{where}: unknown conflict {b['conflict']}")
        if b["tier"] not in ("major", "mid"):
            raise BuildError(f"{where}: tier must be major or mid")
        bid = b["id"] if b["id"] not in seen_b else f"{b['id']}-{len(seen_b)}"
        seen_b.add(bid)
        clean_battles.append({
            "id": bid, "name": str(b["name"]), "conflict": b["conflict"], "tier": b["tier"],
            "start": _iso(b.get("start")), "end": _iso(b.get("end")),
            "place": str(b.get("place") or ""),
            "lat": _num(b["lat"], where, -90, 90), "lng": _num(b["lng"], where, -180, 180),
            "sides": [str(s) for s in b.get("sides") or []],
            "outcome": text(b.get("outcome")), "forces": text(b.get("forces")),
            "losses": text(b.get("losses")), "significance": text(b.get("significance")),
            "sources": _sources(b.get("sources"), where),
        })
    clean_battles.sort(key=lambda x: x["start"], reverse=True)

    # ---------- conflicts ----------
    out_dir = data / "conflicts"
    out_dir.mkdir(exist_ok=True)
    for old in out_dir.glob("*.json"):
        old.unlink()

    light_conflicts = []
    by_country: dict[str, list] = {}
    war: dict[str, int] = {}
    for cid, c in conflicts.items():
        where = f"{c['_file']}: conflict {cid}"
        zones = []
        for z in c.get("zones") or []:
            zones.append({
                "name": str(z.get("name") or ""),
                "lat": _num(z.get("lat"), where + " zone", -90, 90),
                "lng": _num(z.get("lng"), where + " zone", -180, 180),
                "r": max(5.0, min(float(z.get("radius_km") or 50), 900.0)),
                "note": text(z.get("note")),
            })
        lines = []
        for ln in c.get("frontline") or []:
            pts = []
            for p in ln.get("points") or []:
                if isinstance(p, (list, tuple)) and len(p) >= 2:
                    pts.append([_num(p[0], where + " line", -90, 90), _num(p[1], where + " line", -180, 180)])
            if len(pts) >= 2:
                lines.append({"name": str(ln.get("name") or ""), "as_of": _iso(ln.get("as_of")),
                              "points": pts, "source": str(ln.get("source") or "")})
        my_battles = [b for b in clean_battles if b["conflict"] == cid]
        light_conflicts.append({
            "id": cid, "name": str(c["name"]), "type": c["type"], "intensity": c["intensity"],
            "status": c["status"], "started": _iso(c.get("started")), "countries": c["countries"],
            "summary": text(c["summary"]), "zones": zones, "lines": lines,
            "battles": len(my_battles),
        })
        sides = []
        for s in c.get("sides") or []:
            sides.append({
                "name": str(s.get("name") or ""),
                "members": [str(x) for x in s.get("members") or []],
                "backers": [str(x) for x in s.get("backers") or []],
                "leaders": [str(x) for x in s.get("leaders") or []],
                "strength": text(s.get("strength")),
            })
        detail = {
            "id": cid, "name": str(c["name"]), "type": c["type"], "intensity": c["intensity"],
            "status": c["status"], "started": _iso(c.get("started")), "countries": c["countries"],
            "summary": text(c["summary"]), "sides": sides,
            "background": paras(c.get("background")), "year": paras(c.get("year")),
            "situation": paras(c.get("situation")),
            "technical": [text(t) for t in c.get("technical") or []],
            "casualties": text(c.get("casualties")), "displaced": text(c.get("displaced")),
            "timeline": [{"date": _iso(t.get("date")), "event": text(t.get("event"))}
                         for t in sorted(c.get("timeline") or [], key=lambda t: _iso(t.get("date")))],
            "outlook": text(c.get("outlook")),
            "zones": zones, "lines": [{k: v for k, v in ln.items() if k != "points"} for ln in lines],
            "battles": my_battles,
            "sources": _sources(c.get("sources"), where),
            "updated": _iso(c.get("updated")) or None,
        }
        (out_dir / f"{cid}.json").write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")))
        for iso in c["countries"]:
            by_country.setdefault(iso, []).append({"id": cid, "name": str(c["name"]), "intensity": c["intensity"]})
            war[iso] = max(war.get(iso, 0), INTENSITY[c["intensity"]] if c["status"] == "active" else 1)

    light_conflicts.sort(key=lambda x: (-INTENSITY[x["intensity"]], x["name"]))

    # ---------- bases ----------
    bases = []
    bpath = content / "bases.yaml"
    if bpath.exists():
        seen = set()
        for b in (yaml.safe_load(bpath.read_text()) or {}).get("bases") or []:
            where = f"bases.yaml: {b.get('id')}"
            _need(b, ["id", "name", "kind", "lat", "lng"], where)
            if b["kind"] not in BASE_KINDS:
                raise BuildError(f"{where}: unknown kind {b['kind']}")
            bid = b["id"] if b["id"] not in seen else f"{b['id']}-{len(seen)}"
            seen.add(bid)
            bases.append({
                "id": bid, "name": str(b["name"]), "kind": b["kind"],
                "country": b.get("country") if b.get("country") in ids else None,
                "operators": [str(x) for x in b.get("operators") or []],
                "lat": _num(b["lat"], where, -90, 90), "lng": _num(b["lng"], where, -180, 180),
                "tier": b.get("tier") if b.get("tier") in TIERS else "notable",
                "why": text(b.get("why")), "assets": text(b.get("assets")), "year": text(b.get("year")),
                "sources": _sources(b.get("sources"), where),
            })

    military = {
        "built": date.today().isoformat(),
        "conflicts": light_conflicts,
        "battles": [{k: b[k] for k in ("id", "name", "conflict", "tier", "start", "end", "place", "lat", "lng")}
                    for b in clean_battles],
        "bases": bases,
    }
    (data / "military.json").write_text(json.dumps(military, ensure_ascii=False, separators=(",", ":")))

    # ---------- news ----------
    npath = content / "news.yaml"
    news = {"built": date.today().isoformat(), "items": [], "upcoming": []}
    if npath.exists():
        doc = yaml.safe_load(npath.read_text()) or {}
        for n in doc.get("news") or []:
            where = f"news.yaml: {n.get('headline')}"
            _need(n, ["date", "headline"], where)
            cat = n.get("category") if n.get("category") in NEWS_CATS else "political"
            news["items"].append({
                "id": _slug(f"{n['date']}-{n['headline']}")[:80],
                "date": _iso(n["date"]), "pretty": pretty_date(_iso(n["date"])),
                "countries": [x for x in n.get("countries") or [] if x in ids],
                "category": cat, "headline": str(n["headline"]),
                "summary": text(n.get("summary")),
                "conflict": n.get("conflict") if n.get("conflict") in conflicts else None,
                "sources": _sources(n.get("sources"), where),
            })
        for u in doc.get("upcoming") or []:
            if not u.get("date") or not u.get("event"):
                continue
            if _iso(u["date"]) < date.today().isoformat():
                continue
            news["upcoming"].append({
                "date": _iso(u["date"]), "pretty": pretty_date(_iso(u["date"])),
                "countries": [x for x in u.get("countries") or [] if x in ids],
                "event": text(u["event"]),
            })
    news["items"].sort(key=lambda x: x["date"], reverse=True)
    news["upcoming"].sort(key=lambda x: x["date"])
    (data / "news.json").write_text(json.dumps(news, ensure_ascii=False, separators=(",", ":")))

    print(f"build: {len(light_conflicts)} conflicts, {len(clean_battles)} battles, {len(bases)} bases, "
          f"{len(news['items'])} news items")
    return {"by_country": by_country, "war": war}
