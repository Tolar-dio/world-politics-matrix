#!/usr/bin/env python3
"""Fetch the data behind the "Connections" section: trade partners and sanctions regimes.

Run it every few months (trade data updates yearly, sanctions regimes a few times a year):

    python3 scripts/connections.py            # both
    python3 scripts/connections.py trade      # just trade
    python3 scripts/connections.py sanctions  # just sanctions

Writes content/trade.json and content/sanctions.json, which scripts/extras.py folds into each
country's profile. Alliances and blocs (content/blocs.yaml) and arms suppliers
(content/arms.yaml) are maintained by hand; see UPDATING.md.

Sources:
- UN Comtrade public API, total goods trade by partner (exports and imports, US dollars).
  Countries that don't report to Comtrade are filled from their partners' reports ("mirror" data).
- EU Sanctions Map API (sanctionsmap.eu): EU and UN sanctions regimes, by country.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
COMTRADE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
YEARS = [2024, 2023]
# Comtrade reports Taiwan as "Other Asia, not elsewhere specified".
ISO_FIX = {"S19": "TWN"}


def get(url: str) -> dict:
    # curl rather than urllib: some of these hosts refuse Python's default client.
    out = subprocess.run(["curl", "-s", "-m", "60", "--compressed", url], capture_output=True, text=True, check=False)
    if out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError(f"fetch failed: {url}")
    return json.loads(out.stdout)


def our_ids() -> set[str]:
    idx = json.loads((ROOT / "data" / "index.json").read_text())
    return {e["id"] for e in idx["entities"] if e["kind"] == "country"}


def fetch_trade() -> None:
    ids = our_ids()
    reporters = get("https://comtradeapi.un.org/files/v1/app/reference/Reporters.json")["results"]
    codes = {}
    for r in reporters:
        iso = ISO_FIX.get(r.get("reporterCodeIsoAlpha3") or "", r.get("reporterCodeIsoAlpha3"))
        if iso in ids and not r.get("isGroup") and not r.get("entryExpiredDate"):
            codes[iso] = r["reporterCode"]
    # reported[reporter][flow][partner] = usd, for the latest year the reporter has
    reported: dict[str, dict] = {}
    for n, (iso, code) in enumerate(sorted(codes.items()), 1):
        for year in YEARS:
            url = f"{COMTRADE}?reporterCode={code}&period={year}&cmdCode=TOTAL&flowCode=X,M&partner2Code=0&customsCode=C00&motCode=0&includeDesc=true"
            try:
                rows = get(url).get("data") or []
            except Exception as err:  # noqa: BLE001
                print(f"  {iso} {year}: {err}", file=sys.stderr)
                rows = []
            time.sleep(1.1)
            flows = {"X": {}, "M": {}}
            for row in rows:
                p = ISO_FIX.get(row.get("partnerISO") or "", row.get("partnerISO"))
                if row.get("flowCode") in flows and p in ids and p != iso:
                    flows[row["flowCode"]][p] = flows[row["flowCode"]].get(p, 0) + float(row.get("primaryValue") or 0)
            if flows["X"] or flows["M"]:
                reported[iso] = {"year": year, **flows}
                break
        print(f"  [{n}/{len(codes)}] {iso} {reported.get(iso, {}).get('year', 'no data')}", flush=True)

    out = {}
    for iso in sorted(ids):
        r = reported.get(iso)
        if r and r["X"] and r["M"]:
            x, m, year, mirror = r["X"], r["M"], r["year"], False
        else:
            # Mirror: what others say they bought from and sold to this country.
            x = {p: v["M"].get(iso, 0) for p, v in reported.items() if v["M"].get(iso)}
            m = {p: v["X"].get(iso, 0) for p, v in reported.items() if v["X"].get(iso)}
            years = [v["year"] for v in reported.values()]
            year, mirror = max(set(years), key=years.count) if years else YEARS[-1], True
        if not x and not m:
            continue
        tx, tm = sum(x.values()), sum(m.values())
        top = lambda d, t: [[p, round(v), round(v / t * 100, 1)] for p, v in sorted(d.items(), key=lambda kv: -kv[1])[:6]] if t else []
        out[iso] = {"year": year, "mirror": mirror, "exports": round(tx), "imports": round(tm), "to": top(x, tx), "from": top(m, tm)}
    (CONTENT / "trade.json").write_text(json.dumps({"fetched": date.today().isoformat(), "source": "UN Comtrade", "countries": out}, indent=0, separators=(",", ":")))
    print(f"trade: {len(out)} countries ({sum(1 for v in out.values() if v['mirror'])} from partner data)")


def fetch_sanctions() -> None:
    ids = our_ids()
    iso2 = {}
    for r in get("https://comtradeapi.un.org/files/v1/app/reference/Reporters.json")["results"]:
        if r.get("reporterCodeIsoAlpha2") and r.get("reporterCodeIsoAlpha3") in ids:
            iso2[r["reporterCodeIsoAlpha2"]] = r["reporterCodeIsoAlpha3"]
    iso2.setdefault("XK", "XKX")
    regimes = get("https://www.sanctionsmap.eu/api/v1/regime")["data"]
    out: dict[str, list] = {}
    for g in regimes:
        country = ((g.get("country") or {}).get("data") or {}).get("code")
        iso = iso2.get(country or "")
        # Skip thematic regimes (terrorism, cyber, human rights) and the EU blocking statute against US extraterritorial law.
        if not iso or str(g.get("type")) != "0" or "extra-territorial" in (g.get("specification") or ""):
            continue
        by = ((g.get("adopted_by") or {}).get("data") or {}).get("title") or "EU"
        out.setdefault(iso, []).append({
            "by": "UN and EU" if by == "UN" else "EU",
            "what": g["specification"].strip(),
            "url": f"https://www.sanctionsmap.eu/#/main/details/{g['id']}/",
        })
    (CONTENT / "sanctions.json").write_text(json.dumps({"fetched": date.today().isoformat(), "source": "EU Sanctions Map", "countries": out}, ensure_ascii=False, indent=0, separators=(",", ":")))
    print(f"sanctions: {sum(len(v) for v in out.values())} regimes on {len(out)} countries")


if __name__ == "__main__":
    which = sys.argv[1:] or ["sanctions", "trade"]
    if "sanctions" in which:
        fetch_sanctions()
    if "trade" in which:
        fetch_trade()
