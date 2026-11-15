#!/usr/bin/env python3
"""Fetch the country indicators behind the globe's data layers.

Run from the repo root, roughly once a month (the sources update yearly):
    python3 scripts/indicators.py

Writes content/indicators.json: for each indicator, its description, source and the
latest value per country (ISO3), with the year of that value. The build copies it to
data/indicators.json. Values are never edited by hand.
"""
from __future__ import annotations

import csv
import io
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "content" / "indicators.json"
OWID = "https://ourworldindata.org/grapher/{slug}.csv?v=1&csvType=full&useColumnShortNames=false"
OLDEST = 10  # ignore values more than this many years old: a 2009 survey isn't "the latest"

# id, title, group, unit, format, source label, dataset (owid slug + query, or imf code), column, note
INDICATORS = [
    ("democracy", "Electoral democracy", "Governance", "index, 0 to 1", "dec2", "V-Dem, via Our World in Data",
     "electoral-democracy-index", "Electoral democracy index",
     "How far elections are free and fair, with free expression and association. 1 is the most democratic."),
    ("rights", "Human rights", "Governance", "index, 0 to 1", "dec2", "V-Dem, via Our World in Data",
     "human-rights-index-vdem", "Human Rights Index",
     "Freedom from political killing and torture, and freedom of movement, religion and expression. 1 is the most respected."),
    ("press", "Press freedom", "Governance", "score, 0 to 100", "dec0", "Reporters Without Borders, World Press Freedom Index",
     "rsf", None,
     "Reporters Without Borders' World Press Freedom Index score. Higher means a freer press."),
    ("corruption", "Clean government", "Governance", "score, 0 to 100", "dec0", "Transparency International, via Our World in Data",
     "ti-corruption-perception-index", "Corruption Perceptions Index",
     "Transparency International's Corruption Perceptions Index. Higher means less perceived public-sector corruption."),
    ("gdp_pc", "GDP per person", "Economy", "international dollars, adjusted for prices", "usd", "World Bank, via Our World in Data",
     "gdp-per-capita-worldbank", "GDP per capita",
     "Economic output per person, adjusted for what money buys locally (purchasing power parity)."),
    ("income", "Median income", "Economy", "dollars a day, adjusted for prices", "usd2", "World Bank Poverty and Inequality Platform, via Our World in Data",
     "incomes-across-distribution-wb", "Median",
     "What the person in the exact middle lives on each day, from household surveys, adjusted for local prices.",
     "decile=nan&indicator=median&period=day&survey_comparability=no_spells"),
    ("poverty", "Living on under $3 a day", "Economy", "share of people", "pct", "World Bank Poverty and Inequality Platform, via Our World in Data",
     "share-of-population-in-extreme-poverty", "Share of population in poverty ($3 a day)",
     "The share of people below the World Bank's international poverty line of $3 a day (2021 prices)."),
    ("gini", "Inequality", "Economy", "Gini coefficient, 0 to 1", "dec2", "World Bank, via Our World in Data",
     "gini-coefficient-wb", "Gini coefficient",
     "How unequally income or consumption is shared. 0 is perfect equality, 1 is one person holding everything.",
     "survey_comparability=no_spells"),
    ("debt", "Government debt", "Economy", "share of GDP", "pct0", "IMF World Economic Outlook",
     "imf:GGXWDG_NGDP", None,
     "General government gross debt as a share of the economy. IMF figures for the latest year are estimates."),
    ("military", "Military spending", "Security", "share of GDP", "pct1", "SIPRI, via Our World in Data",
     "military-spending-as-a-share-of-gdp-sipri", "Military expenditure (% of GDP)",
     "Military spending as a share of the economy, from the Stockholm International Peace Research Institute."),
    ("homicide", "Murder rate", "Security", "per 100,000 people a year", "dec1", "UN Office on Drugs and Crime, via Our World in Data",
     "homicide-rate-unodc", "Homicide rate per 100,000 population",
     "Intentional homicides per 100,000 people a year."),
    ("median_age", "Median age", "People", "years", "dec1", "UN World Population Prospects, via Our World in Data",
     "median-age", "Median age",
     "Half the population is younger than this, half older."),
    ("fertility", "Children per woman", "People", "births per woman", "dec2", "UN World Population Prospects, via Our World in Data",
     "children-per-woman-un", "Fertility rate",
     "The average number of children a woman would have at current rates. About 2.1 keeps a population stable."),
    ("life_exp", "Life expectancy", "People", "years at birth", "dec1", "UN World Population Prospects, via Our World in Data",
     "life-expectancy", "Life expectancy",
     "How long a newborn would live on average at current death rates."),
    ("happiness", "Life satisfaction", "People", "score, 0 to 10", "dec1", "World Happiness Report, via Our World in Data",
     "happiness-cantril-ladder", "Self-reported life satisfaction",
     "People rate their lives from 0 (worst possible) to 10 (best possible), averaged over three years."),
    ("internet", "Online", "People", "share of people", "pct0", "ITU, via Our World in Data",
     "share-of-individuals-using-the-internet", "Share of the population using the Internet",
     "The share of people who used the internet in the past three months."),
    ("urban", "Living in cities", "People", "share of people", "pct0", "UN World Urbanization Prospects, via Our World in Data",
     "share-urban-and-rural-population", "Urban",
     "The share of people living in urban areas, by each country's own definition."),
]


def fetch(url: str, encoding: str = "utf-8") -> str:
    # curl rather than urllib: some sources (the IMF) turn away Python's default client.
    raw = subprocess.run(["curl", "-sSfL", "-m", "120", url],
                         check=True, capture_output=True).stdout
    return raw.decode(encoding, errors="replace")


def rsf(max_year: int) -> tuple[dict[str, list], str]:
    for year in range(max_year, max_year - 3, -1):
        url = f"https://rsf.org/sites/default/files/import_classement/{year}.csv"
        try:
            text = fetch(url, "latin-1")
        except subprocess.CalledProcessError:
            continue
        rows = csv.DictReader(io.StringIO(text), delimiter=";")
        col = next(c for c in rows.fieldnames if c.startswith("Score "))
        out = {}
        for row in rows:
            iso = (row.get("ISO") or "").strip()
            if len(iso) == 3 and row.get(col):
                out[iso] = [round(float(row[col].replace(",", ".")), 2), year]
        if out:
            return out, url
    raise RuntimeError("no RSF index file found")


def owid(slug: str, column: str, query: str | None, max_year: int) -> dict[str, list]:
    url = OWID.format(slug=slug) + (f"&{query}" if query else "")
    rows = csv.DictReader(io.StringIO(fetch(url)))
    best: dict[str, list] = {}
    for row in rows:
        code = row.get("Code") or ""
        if len(code) != 3 or code.startswith("OWID"):
            continue
        val = row.get(column)
        if val in (None, ""):
            continue
        year = int(row["Year"])
        if year > max_year or year < max_year - OLDEST:
            continue
        if code not in best or year > best[code][1]:
            best[code] = [round(float(val), 4), year]
    return best


def imf(code: str, max_year: int) -> dict[str, list]:
    data = json.loads(fetch(f"https://www.imf.org/external/datamapper/api/v1/{code}"))
    best: dict[str, list] = {}
    for iso, series in data["values"][code].items():
        if len(iso) != 3:
            continue
        years = [int(y) for y, v in series.items() if v is not None and max_year - OLDEST <= int(y) <= max_year]
        if years:
            y = max(years)
            best[iso] = [round(float(series[str(y)]), 2), y]
    return best


def main() -> None:
    this_year = date.today().year
    out = {"fetched": date.today().isoformat(), "indicators": []}
    for spec in INDICATORS:
        iid, title, group, unit, fmt, source, dataset, column, note = spec[:9]
        query = spec[9] if len(spec) > 9 else None
        try:
            if dataset == "rsf":
                values, url = rsf(this_year)
            elif dataset.startswith("imf:"):
                # Latest completed year only: the WEO's current and future years are projections.
                values = imf(dataset[4:], this_year - 1)
                url = f"https://www.imf.org/external/datamapper/{dataset[4:]}@WEO"
            else:
                values = owid(dataset, column, query, this_year)
                url = f"https://ourworldindata.org/grapher/{dataset}"
        except Exception as err:  # keep the previous file's values for this indicator
            print(f"indicators: {iid} failed ({err}); keeping old values", file=sys.stderr)
            old = json.loads(OUT.read_text()) if OUT.exists() else {"indicators": []}
            prev = next((i for i in old["indicators"] if i["id"] == iid), None)
            if prev:
                out["indicators"].append(prev)
            continue
        out["indicators"].append({
            "id": iid, "title": title, "group": group, "unit": unit, "format": fmt,
            "source": source, "url": url, "note": note, "values": values,
        })
        print(f"indicators: {iid:11s} {len(values):3d} countries")
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
