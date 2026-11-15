# Daily update runbook

This file is the standing instruction for the daily update job. It runs once a day as a scheduled task, starting from a fresh session with no memory of earlier runs. Everything it needs to know is here and in the repo.

The job has four duties, in this order of priority:

1. **News.** Record the significant political and military developments of the last day.
2. **Accuracy.** Fix any conflict, country profile or leader that today's news makes out of date.
3. **Rotation.** Re-check the 20 country profiles that have gone longest without a check, so every country gets a fresh look roughly every ten days.
4. **Layers.** Keep storylines, forecasts, voices and the other layers current (section 5).

If time or budget runs short, finish what you started, build, and push. A smaller correct update beats a larger broken one.

## 0. Set up

```bash
pip install pyyaml --break-system-packages   # if missing
python3 scripts/build.py                     # must pass before you change anything
git pull --rebase
```

Today's date comes from the system clock (`date -u +%F`). The window for news is roughly the last 30 hours, so nothing falls between runs.

## 1. News sweep

Search for the day's significant developments worldwide. Look for:

- elections, results, referendums, coups and coup attempts, leaders taking or leaving office, governments falling
- ceasefires, peace talks, summits, major sanctions, big diplomatic shifts
- battles, captured towns, front-line changes, major strikes (missile, drone, air), attacks with heavy casualties, naval incidents, new deployments
- major humanitarian developments (famine declarations, mass displacement)

Good sources: Reuters, AP, AFP, BBC, Al Jazeera, the ISW and Critical Threats daily updates, Crisis Group, Long War Journal, ACLED and UN OCHA updates, plus major regional outlets. Wikipedia's current-events portal is a useful index, but cite the underlying reporting rather than Wikipedia where you can.

Add between 5 and 20 items to the top of `news:` in `content/news.yaml`:

```yaml
news:
  - date: "2026-10-28"            # the day it happened (local time where it happened)
    countries: [UKR, RUS]         # ISO3 codes from content/tenure.yaml
    category: military            # military | political | diplomatic | economic | humanitarian
    conflict: russia-ukraine-war  # optional: id of a conflict in content/military/*.yaml
    headline: "Short headline in sentence case"
    summary: "Two to four sentences: what happened and why it matters."
    sources:
      - {label: "Reuters: headline", url: "https://..."}
    confidence: confirmed         # optional: confirmed | reported | disputed. Left out, the build works it
                                  # out: a wire service or two independent outlets means confirmed
    good: true                    # optional: genuinely good news (a peace deal, a disease beaten, a rescue).
                                  # Aim for at least one a day; the site has a good-news filter
    thread: hormuz-shock          # optional: a storyline id from content/threads.yaml
```

Most items are matched to storylines automatically (by conflict, or by country and keyword). Set `thread:` only when the automatic match would miss it.

Add anything scheduled in the next few weeks to `upcoming:` (date, countries, event). Past items in `upcoming:` drop off the site by themselves.

Keep `news:` to the last 365 days. Move older items into `content/news-archive/<year>.yaml`, which the site doesn't load.

## 2. Conflicts and battles

Conflict data lives in `content/military/*.yaml`, one file per region: `europe-russia-ukraine`, `middle-east-iran-gulf-yemen`, `middle-east-levant-iraq`, `africa-east-north`, `africa-west-central`, `asia-pacific` and `americas`. Bases and chokepoints are in `content/bases.yaml`. The schemas are in `scripts/military.py`; copy the shape of an existing entry when you add one.

For every conflict that today's news touches:

- Rewrite `situation` so it describes the state of play now.
- Append a dated line to `timeline`.
- Update `casualties` or `displaced` only when a named, credible source publishes a new figure, and say who and when.
- If territory changed hands, update `zones` and any `frontline` points, and set its `as_of` date. Lines are approximations drawn from written reporting; never copy map geometry from DeepStateMap, ISW or Liveuamap. Read their descriptions and place points from known town coordinates.
- Change `status` or `intensity` only when the change is clear and lasting.
- Set `updated: "YYYY-MM-DD"` on the conflict.

For a new major or mid-size battle, strike or attack, add an entry to `battles:` in the same file with coordinates (from Wikipedia or GeoHack or an official source), sides, forces, losses and sources. `tier: major` is for strategically decisive or very large engagements; `mid` is for notable ones. If fighting breaks out somewhere new, add a new conflict entry following the schema. Never delete a conflict that ends. Set its status to `fragile-ceasefire` or `frozen` and say why in `situation`.

If a base is struck, expanded or opened, update its `year` text in `content/bases.yaml`.

## 3. Countries in the news

For each country where today's news changes who holds power, the government, or the basic picture:

- **Countries with a full account** (they have an entry in `content/2026/part-*.md`): add or replace `update:` and `update_date:` in its `content/profiles/<region>.yaml` entry. Don't edit the full account itself. If the people in charge changed, set `holders:` too.
- **Countries with a short profile**: rewrite `baseline:` (keep it under about 120 words), update `leaders:` and add to `sources:`.
- Update `snapshot:` and the `story:` tag (`war`, `election`, `unrest`, `shock`, `steady`) if they no longer fit.
- If the top leader changed, update the country in `content/tenure.yaml` (`leader`, `since`).
- Mark the country as checked: `python3 scripts/rotation.py mark ISO3`.

## 4. Rotation

```bash
python3 scripts/rotation.py next 20
```

For each of the 20 countries it lists, check whether anything material has changed since the profile was last checked: search recent news, and confirm the head of state and head of government. Fix anything stale as in step 3, then mark them all:

```bash
python3 scripts/rotation.py mark ISO3 ISO3 ...
```

If nothing changed for a country, marking it is enough. While you're there, check its `argue:` lines in `content/people/` and, for two or three of the 20, add or refresh its voices (section 5).

## 5. The site's other layers

These change less often than the news. Touch them when today's news calls for it, and look after one or two in each run.

### Storylines (`content/threads.yaml`)

The big threads that tie countries together. For each storyline today's news moves:

- Update `status` (`escalating`, `grinding`, `talks`, `shifting`, `cooling`) if it clearly changed.
- Add a `key:` moment for anything that would make a timeline of the year. A key moment can point at a news item with `news: "YYYY-MM-DD headline-start"`: the date and the first words of the headline exactly as in `content/news.yaml`. The build fails if it doesn't match, so copy it.
- Rewrite `watch:` when what to watch for has changed.
- Add `countries:`, `links:` or `keywords:` when the story spreads.

Start a new storyline only for something that will run for months and spans several countries.

### Forecasts (`content/forecasts.yaml`)

Questions tied to live prediction markets. The browser fetches the odds; the file holds the question and a snapshot.

- When a market closes, the site resolves it by itself. If a market can't be read any more, set `resolution: yes` or `no` from reporting.
- Once a week, replace questions decided more than a month ago with new ones on the big open questions. Find markets with `curl -s --compressed "https://gamma-api.polymarket.com/events?closed=false&limit=50&order=volume&ascending=false"` and pick ones with real volume. Copy the market's `slug`, write the question in plain English, and set `snapshot: {prob, as_of}` from the market's current price.
- Tie each to a storyline with `thread:` where one fits.

### Corrections (`content/corrections.yaml`)

When a run fixes a factual mistake the site published (a wrong leader, a wrong date, a misreported event), add an entry: `date`, `where: {type: country|conflict|battle|news, id}`, `what` was fixed, `was`, `now`, `why`, `sources`. Typos and routine updates as events move on are not corrections.

### Everyday life, history, voices

- `content/people/<region>.yaml`: food, music, what people argue about, phrases. Background that stays true for years. In the rotation, check the `argue:` lines still fit (a debate settled by an election is stale).
- `content/past/<region>.yaml`: a short history and a timeline. Add a timeline line only for an event that will matter in ten years (a new constitution, a war's end, independence).
- `content/voices/*.yaml`: what each country's leaders say, what its own press leads with, how outsiders see it. Every item is dated and linked, and anything in quotation marks must be exact. In each rotation, add or refresh voices for two or three of the countries you check, prioritising countries in the news without voices yet. Keep up to three items per list and drop ones over six months old.

### Connections

- `content/blocs.yaml`: alliances and blocs, maintained by hand. When news says a country joined, left or was suspended from a group, update `members` or `status`, bump `as_of`, and add a source.
- `content/arms.yaml`: SIPRI's arms-transfer tables. Each March, when SIPRI publishes its new "Trends in international arms transfers" fact sheet, transcribe tables 1 and 2 and update `period`.
- Trade and sanctions refresh with `python3 scripts/connections.py` (about ten minutes, mostly trade). Run it every three months, or after major new sanctions.

### Data layers

`python3 scripts/indicators.py` refreshes the 17 indicators (democracy, income, life expectancy and so on) from Our World in Data, RSF and the IMF. Run it on the first run of each month. If one source fails, the script keeps its old values; say so in the commit message.

History snapshots for the time machine are written by the build. Nothing to do.

## 6. Verify before you push

Before publishing, check your own work as a second reader would. If your environment lets you start a subagent, give a fresh one the diff (`git diff`) and the sources, and ask it to confirm each changed claim against its source: names, numbers, dates, who did what. Otherwise, re-open each source yourself and check line by line. Fix or remove anything that doesn't hold. If a fix corrects something already published, log it in `content/corrections.yaml`.

## 7. Build, check, publish

```bash
python3 scripts/build.py      # must finish without errors
git add -A
git commit -m "Daily update YYYY-MM-DD: <three to six short phrases naming the main changes>"
git pull --rebase && git push origin HEAD:main
```

End the commit message with any attribution lines your environment asks for. GitHub Pages republishes the site within a few minutes of the push.

## Sources and licences

- **Front lines.** No source publishes openly licensed front-line data. DeepStateMap's licence forbids recreating its map objects and republishing its API, and ISW and Critical Threats need permission to reuse their maps. Our lines are hand-placed approximations built from written reporting and known town coordinates, labelled as approximate. Credit the trackers you read in the conflict's `sources`.
- **GDELT** (gdeltproject.org) may be used freely with a citation and link. Its DOC 2.0 API (`api.gdeltproject.org/api/v2/doc/doc`, rolling three months, up to 250 records a call, JSON or RSS) is good for finding leads, but it's noisy machine-coded data. Confirm every lead against real reporting before it goes on the site.
- **UCDP** data is CC BY 4.0 but lags by about a month, so it's for background figures, not daily news.
- **ACLED** isn't available to this project for automated use: its free tier gives no API and its terms forbid scraping and republishing its maps. Quote ACLED figures only as they appear in news reports, with attribution.
- **ReliefWeb and IOM DTM** APIs need registered app names or keys, which this project doesn't have. Read their published reports through web search instead.
- Quote briefly, paraphrase the rest, and link to the original.

## Rules

- **Verify.** Any claim about casualties, a leadership change, territory changing hands or a coup needs two independent credible sources, or one wire service or official statement. If it's single-sourced and unconfirmed, either leave it out or say "reported" and name who reported it.
- **Cite everything.** Every news item, battle, conflict change and profile change carries at least one source link.
- **Coordinates.** Use Wikipedia, GeoHack or official sources, in decimal degrees to three or four places. Never guess.
- **Write for the site.** Use plain English and no em dashes. Be even-handed and explain why each thing matters. Use the names the countries and parties use, with common English spellings.
- **Keep history.** Don't delete past news, battles or conflicts. Correct mistakes in place and say so in the summary if the correction matters.
- **Stay in scope.** Don't redesign the site, rename files or change schemas during a daily run. If something is broken, note it in the commit message and leave the fix for a human.
- **If the build fails**, fix your YAML (usually an unquoted colon or a bad indent). Never push a failing build.
