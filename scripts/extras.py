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

    # Storylines.
    build_threads(content, data, ids, per_country, md, pretty_date)

    # Forecasts.
    fdoc = _load_yaml(content / "forecasts.yaml") or {}
    thread_ids = {t["id"] for t in json.loads((data / "threads.json").read_text())["threads"]}
    fout = []
    for f in fdoc.get("forecasts") or []:
        where = f"forecasts.yaml: {f.get('id')}"
        mk = f.get("market") or {}
        if not f.get("id") or not f.get("question") or mk.get("source") not in ("polymarket", "manifold") or not mk.get("slug"):
            raise BuildError(f"{where}: needs id, question and market {{source: polymarket|manifold, slug}}")
        if not ISO_DATE.match(str(f.get("closes") or "")):
            raise BuildError(f"{where}: closes must be YYYY-MM-DD")
        if f.get("thread") and f["thread"] not in thread_ids:
            raise BuildError(f"{where}: unknown storyline {f['thread']}")
        snap = f.get("snapshot") or {}
        fout.append({
            "id": f["id"], "question": str(f["question"]), "closes": str(f["closes"]), "pretty": pretty_date(str(f["closes"])),
            "countries": [c for c in f.get("countries") or [] if c in ids], "thread": f.get("thread"),
            "why": str(f.get("why") or ""), "market": {"source": mk["source"], "slug": str(mk["slug"])},
            "snapshot": {"prob": float(snap.get("prob", 0)), "as_of": str(snap.get("as_of") or "")},
            "resolution": f.get("resolution") if f.get("resolution") in ("yes", "no") else None,
        })
    (data / "forecasts.json").write_text(json.dumps({"as_of": str(fdoc.get("as_of") or ""), "forecasts": fout}, ensure_ascii=False, separators=(",", ":")))
    for f in fout:
        for cid in f["countries"]:
            per_country[cid].setdefault("forecasts", []).append(f["id"])

    # Connections: alliances, trade, arms, sanctions.
    build_connections(content, data, ids, per_country, pretty_date)

    # People: food, music, arguments, phrases. Background, so no citations.
    for cid, p in _load_dir(content / "people").items():
        where = f"people/{cid}"
        if cid not in ids:
            raise BuildError(f"{where}: unknown country code")
        say = p.get("say") or {}
        phrases = say.get("phrases") or []
        if phrases and (not say.get("lang") or any(not isinstance(x, list) or len(x) != 3 for x in phrases)):
            raise BuildError(f"{where}: say needs lang, name and phrases as [phrase, meaning, how to say it]")
        per_country[cid]["people"] = {
            "eat": [md(str(x))[0] for x in p.get("eat") or []],
            "listen": [md(str(x))[0] for x in p.get("listen") or []],
            "argue": [md(str(x))[0] for x in p.get("argue") or []],
            "say": {"lang": str(say.get("lang") or ""), "name": str(say.get("name") or ""), "phrases": [[str(a), str(b), str(c)] for a, b, c in phrases]} if phrases else None,
        }

    # How we got here: a short history and a timeline.
    for cid, h in _load_dir(content / "past").items():
        where = f"past/{cid}"
        if cid not in ids:
            raise BuildError(f"{where}: unknown country code")
        tl = h.get("timeline") or []
        if not h.get("story") or any(not isinstance(x, list) or len(x) != 2 for x in tl):
            raise BuildError(f"{where}: needs story and timeline as [year, event]")
        per_country[cid]["past"] = {"story": paras(str(h["story"])), "timeline": [[str(y), md(str(e))[0]] for y, e in tl]}

    # In its own voice: what the country says about itself, what its press says, how others see it. Sourced.
    for cid, v in _load_dir(content / "voices").items():
        where = f"voices/{cid}"
        if cid not in ids:
            raise BuildError(f"{where}: unknown country code")
        out = {}
        for key in ("leader", "press", "abroad"):
            items = []
            for it in v.get(key) or []:
                if not ISO_DATE.match(str(it.get("date") or "")) or not it.get("text") or not str(it.get("url") or "").startswith("http"):
                    raise BuildError(f"{where}.{key}: each item needs date (YYYY-MM-DD), who, text and url")
                items.append({"date": str(it["date"]), "pretty": pretty_date(str(it["date"])), "who": str(it.get("who") or ""),
                              "text": md(str(it["text"]))[0], "url": it["url"], "src": str(it.get("source") or "")})
            out[key] = sorted(items, key=lambda x: x["date"], reverse=True)
        per_country[cid]["voices"] = out

    return {"per_country": per_country}


BLOC_KINDS = {"military", "union", "economic", "political"}


def build_connections(content: Path, data: Path, ids: set[str], per_country: dict, pretty_date) -> None:
    conn: dict[str, dict] = {}
    get = lambda cid: conn.setdefault(cid, {})

    doc = _load_yaml(content / "blocs.yaml") or {}
    blocs = []
    for b in doc.get("blocs") or []:
        where = f"blocs.yaml: {b.get('id')}"
        if not b.get("id") or not b.get("name") or b.get("kind") not in BLOC_KINDS:
            raise BuildError(f"{where}: needs id, name and kind ({', '.join(sorted(BLOC_KINDS))})")
        bad = [m for m in b.get("members") or [] if m not in ids]
        if bad:
            raise BuildError(f"{where}: unknown country codes {bad}")
        status = b.get("status") or {}
        blocs.append({"id": b["id"], "name": b["name"], "short": b.get("short") or b["name"], "kind": b["kind"],
                      "what": str(b.get("what") or ""), "note": str(b.get("note") or ""), "members": b["members"],
                      "status": status, "sources": _sources(b.get("sources"), where)})
        for m in b["members"]:
            get(m).setdefault("blocs", []).append([b["id"], status.get(m, "")])
    as_of = str(doc.get("as_of") or "")

    trade = json.loads((content / "trade.json").read_text()) if (content / "trade.json").exists() else {}
    for cid, t in (trade.get("countries") or {}).items():
        if cid in ids:
            get(cid)["trade"] = t

    arms = _load_yaml(content / "arms.yaml") or {}
    for key, out in (("importers", "arms_in"), ("exporters", "arms_out")):
        for cid, a in (arms.get(key) or {}).items():
            if cid not in ids:
                raise BuildError(f"arms.yaml: unknown country {cid}")
            get(cid)[out] = a

    sanc = json.loads((content / "sanctions.json").read_text()) if (content / "sanctions.json").exists() else {}
    for cid, lst in (sanc.get("countries") or {}).items():
        if cid in ids:
            get(cid)["sanctions"] = lst

    meta = {
        "blocs_as_of": pretty_date(as_of) if as_of else "",
        "trade": {"source": "UN Comtrade", "url": "https://comtradeplus.un.org/", "fetched": trade.get("fetched", "")},
        "arms": {"period": arms.get("period", ""), "previous": arms.get("previous", ""), "source": arms.get("source"), "note": arms.get("note", "")},
        "sanctions": {"source": "EU Sanctions Map", "url": "https://www.sanctionsmap.eu/", "fetched": sanc.get("fetched", "")},
    }
    (data / "connections.json").write_text(json.dumps({"meta": meta, "blocs": blocs}, ensure_ascii=False, separators=(",", ":")))
    for cid, c in conn.items():
        if cid in per_country:
            per_country[cid]["connections"] = c


THREAD_STATUS = {"escalating", "grinding", "talks", "shifting", "cooling"}


def build_threads(content: Path, data: Path, ids: set[str], per_country: dict, md, pretty_date) -> None:
    doc = _load_yaml(content / "threads.yaml") or {}
    news_path = data / "news.json"
    news = json.loads(news_path.read_text()) if news_path.exists() else {"items": []}
    mil_path = data / "military.json"
    conflicts = {c["id"] for c in json.loads(mil_path.read_text())["conflicts"]} if mil_path.exists() else set()
    out = []
    for th in doc.get("threads") or []:
        tid = th.get("id") or ""
        where = f"threads.yaml: {tid or th.get('title')}"
        if not re.match(r"^[a-z0-9-]+$", tid) or not th.get("title"):
            raise BuildError(f"{where}: needs a kebab-case id and a title")
        if th.get("status") not in THREAD_STATUS:
            raise BuildError(f"{where}: status must be one of {', '.join(sorted(THREAD_STATUS))}")
        links = []
        for ln in th.get("links") or []:
            if ln.get("from") not in ids or ln.get("to") not in ids:
                raise BuildError(f"{where}: link {ln.get('from')} to {ln.get('to')} uses an unknown country code")
            links.append({"from": ln["from"], "to": ln["to"], "label": str(ln.get("label") or "")})
        tc = [c for c in th.get("conflicts") or [] if c in conflicts]
        unknown = [c for c in th.get("conflicts") or [] if c not in conflicts]
        if unknown:
            raise BuildError(f"{where}: unknown conflict ids {unknown}")
        m = th.get("match") or {}
        mc = set(m.get("countries") or [])
        kw = [k.lower() for k in m.get("keywords") or []]

        def matches(n):
            if n.get("thread") == tid or (n.get("conflict") and n["conflict"] in tc):
                return True
            # Keyword matches skip items filed under some other war, to keep threads from swallowing each other.
            if n.get("conflict") and n["conflict"] not in tc:
                return False
            if mc & set(n.get("countries") or []):
                hay = (n["headline"] + " " + re.sub("<[^>]+>", "", n.get("summary") or "")).lower()
                return any(k in hay for k in kw)
            return False

        hits = [n for n in news["items"] if matches(n)]
        for n in hits:
            n.setdefault("threads", [])
            if tid not in n["threads"]:
                n["threads"].append(tid)
        key = []
        for k in th.get("key") or []:
            if not ISO_DATE.match(str(k.get("date") or "")):
                raise BuildError(f"{where}: milestone needs a YYYY-MM-DD date")
            item = {"date": str(k["date"]), "pretty": pretty_date(str(k["date"])), "text": md(str(k.get("text") or ""))[0]}
            if k.get("conflict"):
                if k["conflict"] not in conflicts:
                    raise BuildError(f"{where}: milestone links unknown conflict {k['conflict']}")
                item["conflict"] = k["conflict"]
            elif k.get("news"):
                ref = str(k["news"])
                d, _, start = ref.partition(" ")
                found = next((n for n in news["items"] if n["date"] == d and n["headline"].lower().startswith(start.lower())), None)
                if not found:
                    raise BuildError(f"{where}: milestone news '{ref}' matches no news item (use 'YYYY-MM-DD start of headline')")
                item["news"] = found["id"]
                item["sources"] = found["sources"][:2]
            else:
                item["sources"] = _sources(k.get("sources"), where)
                if not item["sources"]:
                    raise BuildError(f"{where}: milestone '{k.get('text')}' needs a conflict, news or sources reference")
            key.append(item)
        key.sort(key=lambda x: x["date"])
        countries = sorted(mc | {x for ln in links for x in (ln["from"], ln["to"])})
        out.append({
            "id": tid, "title": str(th["title"]), "dek": str(th.get("dek") or ""), "status": th["status"],
            "why": md(" ".join(str(th.get("why") or "").split()))[0], "watch": md(" ".join(str(th.get("watch") or "").split()))[0],
            "links": links, "conflicts": tc, "countries": countries, "key": key,
            "news": [n["id"] for n in hits[:30]], "latest": hits[0]["date"] if hits else None,
            "count7": sum(1 for n in hits if n["date"] >= _days_ago(news, 7)),
        })
        for cid in countries:
            if cid in per_country:
                per_country[cid].setdefault("threads", []).append({"id": tid, "title": str(th["title"])})
    (data / "threads.json").write_text(json.dumps({"threads": out}, ensure_ascii=False, separators=(",", ":")))
    news_path.write_text(json.dumps(news, ensure_ascii=False, separators=(",", ":")))


def _days_ago(news: dict, n: int) -> str:
    latest = max((x["date"] for x in news["items"]), default=date.today().isoformat())
    y, m, d = map(int, latest.split("-"))
    from datetime import timedelta
    return (date(y, m, d) - timedelta(days=n - 1)).isoformat()
