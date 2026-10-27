#!/usr/bin/env python3
"""Build the site's data files from the content folder.

Run from the repo root:  python3 scripts/build.py

Inputs
  content/2026/part-*.md       the "World in 2026" parts, as written (markdown)
  content/profiles/*.yaml      culture, society and situation profiles per country
  scripts/source/countries-base.json   capitals, languages, currencies, areas (world-countries, ODbL)
  scripts/source/world-ne50.topo.json  country shapes (Natural Earth 1:50m, public domain)

Outputs
  data/world.topo.json         country shapes keyed by the site's ids
  data/index.json              everything the globe needs to colour and label countries
  data/countries/<ID>.json     the full briefing for one country, loaded when it is clicked
"""
from __future__ import annotations

import html
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
DATA = ROOT / "data"
SOURCE = ROOT / "scripts" / "source"

# Natural Earth codes that differ from the ids the site uses.
GEO_REMAP = {
    "SDS": "SSD",  # South Sudan
    "SAH": "ESH",  # Western Sahara
    "PSX": "PSE",  # Palestine
    "KOS": "XKX",  # Kosovo
    "SOL": "SOM",  # Somaliland is drawn as part of Somalia's entry
    "CYN": "CYP",  # Northern Cyprus is drawn as part of Cyprus's entry
}
GEO_NEUTRAL = {"ATA", "KAS"}  # drawn, not clickable

SOVEREIGN_CODES = {
    "US1": "USA", "GB1": "GBR", "NZ1": "NZL", "NL1": "NLD", "FR1": "FRA",
    "FI1": "FIN", "DN1": "DNK", "CH1": "CHN", "AU1": "AUS", "IS1": "ISR",
}

# Places that are not UN members but get a full entry.
EXTRA_MAIN = {"VAT": "VAT", "PSE": "PSE", "UNK": "XKX", "TWN": "TWN"}

TERRITORY_NOTES = {
    "GRL": "Greenland is a self-governing part of the Kingdom of Denmark, with its own parliament and control over most domestic affairs. Copenhagen still runs its defence and foreign policy, which is why Trump's talk of buying or taking it lands on Denmark's desk.",
    "HKG": "Hong Kong is a special administrative region of China. The 'one country, two systems' arrangement promised it autonomy until 2047, but the 2020 National Security Law brought it firmly under Beijing's political control.",
    "MAC": "Macao is a special administrative region of China and the world's biggest gambling hub by revenue. It has been governed closely in line with Beijing since its handover from Portugal in 1999.",
    "ESH": "Western Sahara is a disputed territory. Morocco controls most of it and calls it its southern provinces; the Polisario Front, backed by Algeria, claims it as the Sahrawi Arab Democratic Republic. The UN still lists it as a non-self-governing territory.",
    "PRI": "Puerto Rico is a US territory. Its 3.2 million people are US citizens but have no vote for president and only a non-voting delegate in Congress, and the island's status (statehood, independence or the current arrangement) is still argued over.",
    "NCL": "New Caledonia is a French overseas collectivity in the Pacific, rich in nickel. Deadly riots in 2024 over voting rules reopened the long fight over independence between the Indigenous Kanak and settlers' descendants.",
    "FLK": "The Falkland Islands are a self-governing British overseas territory, also claimed by Argentina, which lost a war over them in 1982.",
    "COK": "The Cook Islands govern themselves in free association with New Zealand, whose citizenship islanders hold. A 2025 partnership deal with China strained that relationship.",
    "NIU": "Niue is a self-governing island in free association with New Zealand, with about 1,700 residents and far more Niueans living in New Zealand.",
    "ALA": "Åland is an autonomous, Swedish-speaking, demilitarised region of Finland.",
}

MIDDLE_EAST = {"BHR", "IRN", "IRQ", "ISR", "JOR", "KWT", "LBN", "OMN", "PSE", "QAT", "SAU", "SYR", "TUR", "ARE", "YEM"}
CAUCASUS = {"ARM", "AZE", "GEO"}  # grouped with Europe, as in the series


def browse_group(cid: str, region: str | None) -> str:
    if cid in MIDDLE_EAST:
        return "Middle East"
    if cid in CAUCASUS:
        return "Europe"
    return region or "Asia"


STORY_KEYS = {"war", "election", "unrest", "shock", "steady"}
SYSTEM_KEYS = {
    "presidential", "semi-presidential", "parliamentary", "const-monarchy",
    "exec-monarchy", "one-party", "military", "religious", "contested",
}

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def fail(msg: str) -> None:
    print(f"build: {msg}", file=sys.stderr)
    sys.exit(1)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z]", "", s.lower())


# ---------- inline markdown ----------
LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")


def md_inline(text: str) -> tuple[str, list[dict]]:
    """Convert the small markdown subset the parts use into safe HTML."""
    links: list[dict] = []
    out, pos = [], 0
    for m in LINK_RE.finditer(text):
        out.append(_fmt(html.escape(text[pos:m.start()], quote=False)))
        label, url = m.group(1), m.group(2)
        links.append({"label": label, "url": url})
        out.append(
            f'<a href="{html.escape(url)}" target="_blank" rel="noopener">'
            f"{_fmt(html.escape(label, quote=False))}</a>"
        )
        pos = m.end()
    out.append(_fmt(html.escape(text[pos:], quote=False)))
    return "".join(out), links


def _fmt(s: str) -> str:
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)
    return s


# ---------- base data ----------
def load_base() -> dict[str, dict]:
    raw = json.loads((SOURCE / "countries-base.json").read_text())
    base = {}
    for c in raw:
        cid = EXTRA_MAIN.get(c["cca3"], c["cca3"])
        c["id"] = cid
        base[cid] = c
    return base


def main_ids(base: dict[str, dict]) -> set[str]:
    ids = {cid for cid, c in base.items() if c.get("unMember")}
    ids |= set(EXTRA_MAIN.values())
    return ids


def alias_table(base: dict[str, dict], ids: set[str]) -> dict[str, str]:
    table: dict[str, str] = {}
    for cid in ids:
        c = base[cid]
        for n in [c["name"], c["official"], *(c.get("altSpellings") or [])]:
            if n and len(n) > 3:
                table.setdefault(norm(n), cid)
    manual = {
        "United States": "USA", "USA": "USA", "United Kingdom": "GBR", "UK": "GBR",
        "DR Congo": "COD", "Democratic Republic of the Congo": "COD",
        "Republic of Congo": "COG", "Republic of the Congo": "COG", "Congo": "COG",
        "Holy See": "VAT", "Vatican": "VAT", "Palestine": "PSE", "Kosovo": "XKX",
        "Taiwan": "TWN", "Turkey": "TUR", "Türkiye": "TUR", "Czechia": "CZE",
        "Czech Republic": "CZE", "Côte d'Ivoire": "CIV", "Ivory Coast": "CIV",
        "South Korea": "KOR", "North Korea": "PRK", "Russia": "RUS", "Iran": "IRN",
        "Syria": "SYR", "Laos": "LAO", "Vietnam": "VNM", "Bolivia": "BOL",
        "Venezuela": "VEN", "Tanzania": "TZA", "Moldova": "MDA", "Brunei": "BRN",
        "Eswatini": "SWZ", "Cabo Verde": "CPV", "Cape Verde": "CPV",
        "East Timor": "TLS", "Timor-Leste": "TLS", "Micronesia": "FSM",
        "UAE": "ARE", "United Arab Emirates": "ARE", "The Gambia": "GMB",
        "Gambia": "GMB", "The Bahamas": "BHS", "Bahamas": "BHS",
        "North Macedonia": "MKD", "São Tomé and Príncipe": "STP",
        "Saint Kitts and Nevis": "KNA", "Saint Lucia": "LCA",
        "Saint Vincent and the Grenadines": "VCT", "Myanmar": "MMR",
        "Netherlands": "NLD", "Philippines": "PHL",
    }
    for k, v in manual.items():
        table[norm(k)] = v
    return table


# ---------- parts ----------
FRONT_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)


def parse_parts(aliases: dict[str, str]) -> tuple[list[dict], dict[str, dict]]:
    parts_meta, entries = [], {}
    for path in sorted((CONTENT / "2026").glob("part-*.md")):
        text = path.read_text()
        m = FRONT_RE.match(text)
        if not m:
            fail(f"{path.name}: missing front matter")
        meta = yaml.safe_load(m.group(1))
        body = text[m.end():]
        part_no = int(meta["part"])
        as_of = str(meta["as_of"])
        count = 0
        region = None
        current = None

        def flush():
            nonlocal current, count
            if not current:
                return
            cid = aliases.get(norm(current["name"]))
            if not cid:
                fail(f"{path.name}: can't match country heading '{current['name']}'")
            story, power, holders, links = [], None, None, []
            for para in current["paras"]:
                h, ls = md_inline(para)
                links += ls
                if para.startswith("**How power works:**"):
                    power = md_inline(para.split(":**", 1)[1].strip())[0]
                elif para.startswith("**Who holds power:**"):
                    holders = md_inline(para.split(":**", 1)[1].strip())[0]
                else:
                    story.append(h)
            seen, sources = set(), []
            for ln in links:
                if ln["url"] not in seen:
                    seen.add(ln["url"])
                    sources.append(ln)
            entry = {
                "part": part_no, "as_of": as_of, "region_heading": current["region"],
                "story": story, "power": power, "holders": holders, "sources": sources,
            }
            prev = entries.get(cid)
            if not prev or (prev["as_of"], prev["part"]) <= (as_of, part_no):
                entries[cid] = entry
            count += 1
            current = None

        for block in re.split(r"\n\s*\n", body):
            block = block.strip()
            if not block:
                continue
            if block.startswith("## "):
                flush()
                region = block[3:].strip()
                continue
            if block.startswith("### "):
                flush()
                first, _, rest = block.partition("\n")
                current = {"name": first[4:].strip(), "region": region, "paras": []}
                if rest.strip():
                    current["paras"].append(" ".join(rest.split()))
                continue
            if current is not None:
                current["paras"].append(" ".join(block.split()))
        flush()
        parts_meta.append({"part": part_no, "title": meta.get("title", ""), "as_of": as_of, "count": count})
    return parts_meta, entries


# ---------- profiles ----------
def load_profiles(ids: set[str]) -> dict[str, dict]:
    profiles: dict[str, dict] = {}
    for path in sorted((CONTENT / "profiles").glob("*.yaml")):
        data = yaml.safe_load(path.read_text()) or {}
        for cid, p in data.items():
            if cid not in ids:
                fail(f"{path.name}: unknown id {cid}")
            if cid in profiles:
                fail(f"{path.name}: {cid} appears twice")
            if p.get("system") and p["system"] not in SYSTEM_KEYS:
                fail(f"{path.name}: {cid} has unknown system '{p['system']}'")
            if p.get("story") and p["story"] not in STORY_KEYS:
                fail(f"{path.name}: {cid} has unknown story '{p['story']}'")
            profiles[cid] = p
    return profiles


def pretty_date(iso: str) -> str:
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{d} {MONTHS[m - 1]} {y}"


def fmt_pop(millions) -> str | None:
    if millions is None:
        return None
    if millions >= 1000:
        return f"About {millions / 1000:.2f} billion"
    if millions >= 10:
        return f"About {millions:.0f} million"
    if millions >= 1:
        return f"About {millions:.1f} million"
    return f"About {round(millions * 1000):,} thousand" if millions * 1000 >= 10 else f"About {round(millions * 1e6):,}"


def paras(text: str | None) -> list[str]:
    if not text:
        return []
    return [md_inline(" ".join(p.split()))[0] for p in re.split(r"\n\s*\n", text.strip())]


# ---------- main ----------
def main() -> None:
    base = load_base()
    ids = main_ids(base)
    aliases = alias_table(base, ids)
    parts_meta, narratives = parse_parts(aliases)
    profiles = load_profiles(ids)

    topo = json.loads((SOURCE / "world-ne50.topo.json").read_text())
    geoms = topo["objects"]["countries"]["geometries"]
    shapes: dict[str, str] = {}
    territories: dict[str, dict] = {}
    for g in geoms:
        p = g["properties"]
        code = p["ADM0_A3"]
        if code in GEO_NEUTRAL:
            g["properties"] = {"id": None}
            continue
        cid = GEO_REMAP.get(code, code)
        if code == "ALD":
            cid = "ALA"
        if cid not in ids:
            sov = SOVEREIGN_CODES.get(p["SOV_A3"])
            if code in ("IOA", "ATC"):
                cid = "AUS"
            else:
                territories[cid] = {"id": cid, "name": p["NAME"], "sovereign": sov}
        g["properties"] = {"id": cid}
        shapes[cid] = p["NAME"]
    DATA.joinpath("world.topo.json").write_text(json.dumps(topo, separators=(",", ":")))

    out_dir = DATA / "countries"
    for old in out_dir.glob("*.json"):
        old.unlink()

    aka: dict[str, list[str]] = {}
    for alias, target in aliases.items():
        aka.setdefault(target, []).append(alias)

    entities = []
    for cid in sorted(ids):
        c = base[cid]
        prof = profiles.get(cid, {})
        nar = narratives.get(cid)
        tiny = cid not in shapes or (c.get("area") or 0) < 2600
        lat, lng = c.get("latlng") or [0, 0]
        langs = list((c.get("languages") or {}).values())
        currs = [f"{v['name']}" for v in (c.get("currencies") or {}).values()]
        name = prof.get("name") or c["name"]
        entities.append({
            "id": cid, "name": name, "flag": c.get("flag", ""), "region": c.get("region"),
            "subregion": c.get("subregion"), "lat": lat, "lng": lng, "tiny": tiny,
            "system": prof.get("system"), "story": prof.get("story") if nar else None,
            "part": nar["part"] if nar else None, "snapshot": prof.get("snapshot"),
            "kind": "country", "area": round(c.get("area") or 0),
            "group": browse_group(cid, c.get("region")),
            "aka": sorted({a for a in aka.get(cid, []) if a != norm(name)}, key=len)[:6],
        })
        detail = {
            "id": cid, "name": name, "official": c.get("official"), "flag": c.get("flag", ""),
            "region": c.get("region"), "subregion": c.get("subregion"),
            "facts": {
                "capital": ", ".join(c.get("capital") or []) or prof.get("capital"),
                "population": fmt_pop(prof.get("pop")),
                "area": f"{round(c['area']):,} km²" if c.get("area") else None,
                "languages": ", ".join(langs) if langs else None,
                "religion": prof.get("religion"),
                "currency": ", ".join(currs) if currs else None,
            },
            "system": prof.get("system"), "system_note": prof.get("system_note"),
            "story": prof.get("story") if nar else None,
            "snapshot": prof.get("snapshot"),
            "tags": prof.get("tags") or [],
            "culture": paras(prof.get("culture")),
            "society": paras(prof.get("society")),
            "baseline": paras(prof.get("baseline")),
            "leaders": prof.get("leaders"),
            "briefing": None,
        }
        if nar:
            detail["briefing"] = {
                "part": nar["part"], "as_of": pretty_date(nar["as_of"]),
                "story": nar["story"], "power": nar["power"], "holders": nar["holders"],
                "sources": nar["sources"],
            }
        (out_dir / f"{cid}.json").write_text(json.dumps(detail, ensure_ascii=False, separators=(",", ":")))

    for tid, t in sorted(territories.items()):
        sov = t["sovereign"]
        sov_name = base[sov]["name"] if sov in base else None
        if sov in ("NLD", "GBR", "USA"):
            sov_name = "the " + sov_name
        note = TERRITORY_NOTES.get(tid) or (
            f"{t['name']} is a territory of {sov_name}. It doesn't get its own write-up; "
            f"its politics run through the entry for {sov_name}." if sov_name else ""
        )
        entities.append({
            "id": tid, "name": base[tid]["name"] if tid in base else t["name"],
            "flag": base[tid]["flag"] if tid in base else "", "region": base[tid]["region"] if tid in base else None,
            "kind": "territory", "sovereign": sov, "note": note, "tiny": False,
            "area": round((base.get(tid) or {}).get("area") or 0),
            "lat": (base.get(tid) or {}).get("latlng", [0, 0])[0],
            "lng": (base.get(tid) or {}).get("latlng", [0, 0])[1],
        })

    covered = sum(1 for e in entities if e.get("part"))
    profiled = sum(1 for cid in ids if profiles.get(cid, {}).get("culture"))
    index = {
        "built": date.today().isoformat(),
        "parts": parts_meta,
        "counts": {"countries": len(ids), "briefed": covered, "profiled": profiled},
        "entities": entities,
    }
    (DATA / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))

    missing_prof = sorted(cid for cid in ids if not profiles.get(cid, {}).get("culture"))
    print(f"build: {len(ids)} countries, {covered} with 2026 briefings, {profiled} with profiles, {len(territories)} territories")
    if missing_prof:
        print(f"build: no profile yet for {len(missing_prof)}: {' '.join(missing_prof)}")
    no_story = sorted(cid for cid in narratives if not profiles.get(cid, {}).get("story"))
    if no_story:
        print(f"build: briefed but no storyline tag: {' '.join(no_story)}")


if __name__ == "__main__":
    main()
