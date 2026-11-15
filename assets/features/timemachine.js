/* Time machine: scrub the globe back through the past year, and see what changed this week. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  const $ = (s, r = document) => r.querySelector(s);
  const DAY = 864e5;
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const addDays = (s, n) => iso(Date.parse(s) + n * DAY);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const today = iso(Date.now());
  const START = addDays(today, -400); // a little over a year back
  let days = [];            // dates with a snapshot
  const snaps = new Map();  // date -> snapshot
  let on = false, T = today, playing = null;

  /* ---------- snapshots ---------- */
  async function loadIndex() {
    if (days.length) return days;
    try { days = (await fetch('data/history/index.json').then((r) => r.json())).days || []; } catch (_) { days = []; }
    return days;
  }
  // The latest snapshot on or before a date.
  function dayFor(date) {
    let best = null;
    for (const d of days) if (d <= date) best = d; else break;
    return best;
  }
  async function snap(date) {
    const d = dayFor(date);
    if (!d) return null;
    if (!snaps.has(d)) snaps.set(d, fetch(`data/history/${d}.json`).then((r) => r.json()).catch(() => null));
    return snaps.get(d);
  }

  /* ---------- what the globe shows at date T ---------- */
  const inWindow = (date, from, to) => date >= from && date <= to;
  const newsIn = (from, to) => W.news.items.filter((n) => inWindow(n.date, from, to));
  const battleActive = (b, t) => b.start <= t && (!b.end || /ongoing/i.test(b.end) || b.end >= addDays(t, -10));

  let tmLines = [];
  function apply() {
    if (!on) {
      W.ext.battleFilter = null;
      W.ext.conflictVisible = null;
      W.ext.lineSource = null;
      W.setRings('tm', []);
      W.refreshLayers();
      return;
    }
    W.ext.battleFilter = (b) => battleActive(b, T);
    W.ext.conflictVisible = (c) => !c || !c.started || c.started <= T;
    W.ext.lineSource = () => tmLines;
    const fresh = W.mil.battles.filter((b) => inWindow(b.start, addDays(T, -14), T));
    W.setRings('tm', W.reduceMotion ? [] : fresh.map((b) => ({ lat: b.lat, lng: b.lng, maxR: b.tier === 'major' ? 3.2 : 2, speed: 1.4, rgb: '243,210,122' })));
    snap(T).then((s) => {
      const exact = s && s.date === dayFor(T) && T >= days[0];
      tmLines = exact ? Object.entries(s.lines || {}).flatMap(([conflict, lines]) => lines.map(([name, points]) => ({ name, points, conflict }))) : [];
      W.refreshLayers();
    });
    W.refreshLayers();
  }

  // Politics mode: countries glow by how much news they made in the week up to T.
  const HEAT = ['#F6E7C1', '#EECB7C', '#DFA448', '#C27A2C', '#8E521C'];
  const HEAT_DARK = ['#4D4330', '#6E5B34', '#94753A', '#BD9341', '#E5B85C'];
  let heat = new Map();
  function computeHeat() {
    heat = new Map();
    for (const n of newsIn(addDays(T, -6), T)) for (const c of n.countries) heat.set(c, (heat.get(c) || 0) + 1);
  }
  W.ext.colorOverrides.push((e) => {
    if (!on || W.state.mode !== 'politics' || e.kind !== 'country') return null;
    const n = heat.get(e.id) || 0;
    if (!n) return W.cssVar('--quiet');
    const r = W.isDark() ? HEAT_DARK : HEAT;
    return r[Math.min(4, n === 1 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4)];
  });

  /* ---------- the bar ---------- */
  function weeklyCounts() {
    const weeks = [];
    for (let d = START; d <= today; d = addDays(d, 7)) {
      const to = addDays(d, 6);
      const b = W.mil.battles.filter((x) => inWindow(x.start, d, to)).length;
      const n = newsIn(d, to).length;
      weeks.push({ d, b, n });
    }
    return weeks;
  }

  function buildBar() {
    const span = Math.round((Date.parse(today) - Date.parse(START)) / DAY);
    const weeks = weeklyCounts();
    const max = Math.max(1, ...weeks.map((w) => w.b * 3 + w.n));
    const bars = weeks.map((w, i) => {
      const x = (i / weeks.length) * 100, wd = 100 / weeks.length;
      const hb = (w.b * 3 / max) * 100, hn = (w.n / max) * 100;
      return `<rect x="${x}%" width="${wd * 0.8}%" y="${100 - hb - hn}%" height="${hn}%" class="tm-n"/><rect x="${x}%" width="${wd * 0.8}%" y="${100 - hb}%" height="${hb}%" class="tm-b"/>`;
    }).join('');
    const months = [];
    for (let i = 0; i <= span; i += 1) {
      const d = addDays(START, i);
      if (d.endsWith('-01')) months.push(`<span class="${[1, 4, 7, 10].includes(+d.slice(5, 7)) ? 'q' : ''}" style="left:${(i / span) * 100}%">${MONTHS[+d.slice(5, 7) - 1]}${d.slice(5, 7) === '01' ? ` ${d.slice(0, 4)}` : ''}</span>`);
    }
    const firstSnap = days.length ? Math.round((Date.parse(days[0]) - Date.parse(START)) / DAY) : span;
    const bar = document.createElement('div');
    bar.className = 'tm-bar';
    bar.id = 'tm-bar';
    bar.innerHTML = `
      <button type="button" class="tm-play" id="tm-play" aria-label="Play through time"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg></button>
      <div class="tm-track">
        <div class="tm-label"><button type="button" class="tm-date" id="tm-date"></button><span id="tm-sub"></span></div>
        <div class="tm-scale">
          <svg class="tm-spark" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>
          <span class="tm-daily" style="left:${(firstSnap / span) * 100}%" title="Daily snapshots of leaders and front lines start here"></span>
          <input type="range" id="tm-range" min="0" max="${span}" step="1" value="${span}" aria-label="Date">
        </div>
        <div class="tm-months" aria-hidden="true">${months.join('')}</div>
      </div>
      <button type="button" class="tm-btn" id="tm-today">Today</button>
      <button type="button" class="close tm-close" id="tm-close" aria-label="Close the time machine"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
    $('#stage').appendChild(bar);
    const range = $('#tm-range');
    range.addEventListener('input', () => setDate(addDays(START, +range.value)));
    $('#tm-today').addEventListener('click', () => { stop(); setDate(today); });
    $('#tm-close').addEventListener('click', () => setOn(false));
    $('#tm-play').addEventListener('click', () => (playing ? stop() : play()));
    $('#tm-date').addEventListener('click', () => openDay(T));
  }

  function play() {
    if (T >= today) setDate(START);
    $('#tm-play').classList.add('on');
    $('#tm-play').setAttribute('aria-label', 'Pause');
    playing = setInterval(() => {
      const next = addDays(T, 3);
      if (next >= today) { setDate(today); stop(); return; }
      setDate(next);
    }, 260);
  }
  function stop() {
    clearInterval(playing);
    playing = null;
    const b = $('#tm-play');
    if (b) { b.classList.remove('on'); b.setAttribute('aria-label', 'Play through time'); }
  }

  let panelTimer = null;
  function setDate(d) {
    T = d < START ? START : d > today ? today : d;
    const range = $('#tm-range');
    if (range) range.value = Math.round((Date.parse(T) - Date.parse(START)) / DAY);
    const [y, m, dd] = T.split('-').map(Number);
    $('#tm-date').textContent = T === today ? 'Today' : `${dd} ${MONTHS[m - 1]} ${y}`;
    const wk = addDays(T, -6);
    const nb = W.mil.battles.filter((b) => inWindow(b.start, wk, T)).length;
    const nn = newsIn(wk, T).length;
    $('#tm-sub').textContent = W.state.mode === 'conflict'
      ? `${W.mil.battles.filter((b) => battleActive(b, T)).length} battles under way, ${nb} began that week`
      : nn ? `${nn} news stories that week. Brighter countries made more news.` : T < (W.news.items[W.news.items.length - 1] || {}).date ? 'The news archive starts in October 2026. Switch to Conflicts to see the year of battles.' : 'A quiet week in the archive.';
    computeHeat();
    apply();
    if (location.hash.startsWith('#time/')) { clearTimeout(panelTimer); panelTimer = setTimeout(() => openDay(T), playing ? 600 : 150); }
  }

  async function setOn(next) {
    on = next;
    document.body.classList.toggle('tm-on', on);
    const btn = $('#tm-btn');
    if (btn) btn.setAttribute('aria-pressed', String(on));
    if (on) {
      await loadIndex();
      if (!$('#tm-bar')) buildBar();
      $('#tm-bar').hidden = false;
      setDate(T);
    } else {
      stop();
      if ($('#tm-bar')) $('#tm-bar').hidden = true;
      heat = new Map();
      apply();
      W.refreshPolygons();
      if (location.hash.startsWith('#time/')) W.closeProfile();
    }
  }

  W.on('mode', () => { if (on) setDate(T); });

  /* ---------- panels: a single day, and this week ---------- */
  function diff(a, b) {
    const out = { leaders: [], war: [], conflicts: [], newConflicts: [] };
    if (!a || !b) return out;
    for (const [cid, [lead, since]] of Object.entries(b.leaders)) {
      const old = a.leaders[cid];
      if (old && old[0] && lead && old[0] !== lead) out.leaders.push({ cid, from: old[0], to: lead, since });
    }
    for (const [id, cur] of Object.entries(b.conflicts)) {
      const old = a.conflicts[id];
      if (!old) { out.newConflicts.push({ id, name: cur[3] }); continue; }
      if (old[0] !== cur[0] || old[1] !== cur[1]) out.conflicts.push({ id, name: cur[3], from: `${old[0]}, ${old[1].replace('-', ' ')}`, to: `${cur[0]}, ${cur[1].replace('-', ' ')}` });
    }
    return out;
  }

  const countryBtn = (cid) => { const e = W.byId.get(cid); return e ? `<button type="button" class="link" data-id="${cid}">${esc(e.flag)} ${esc(e.name)}</button>` : esc(cid); };
  const newsRows = (items) => `<ul class="news-mini">${items.map((n) => `<li><span class="news-date">${esc(W.fmtDate(n.date).replace(/ \d{4}$/, ''))}</span><a href="news.html#${esc(n.id)}">${esc(n.headline)}</a></li>`).join('')}</ul>`;
  const battleRows = (list) => `<ul class="battle-list">${list.map((b) => `<li><button type="button" data-battle="${b.id}"><span class="bl-date">${esc(W.fmtDate(b.start))}</span><span class="bl-name">${esc(b.name)}<small>${esc(b.place)}</small></span><span class="tier ${b.tier}">${b.tier === 'major' ? 'Major' : 'Mid'}</span></button></li>`).join('')}</ul>`;

  function changeList(d) {
    const rows = [
      ...d.leaders.map((x) => `<li><b>New leader in ${countryBtn(x.cid)}.</b> ${esc(x.to)} replaced ${esc(x.from)}.</li>`),
      ...d.newConflicts.map((x) => `<li><b>New conflict on the map:</b> <button type="button" class="link" data-conflict="${x.id}">${esc(x.name)}</button>.</li>`),
      ...d.conflicts.map((x) => `<li><button type="button" class="link" data-conflict="${x.id}">${esc(x.name)}</button> went from ${esc(x.from)} to ${esc(x.to)}.</li>`),
    ];
    return rows.length ? `<ul class="changes">${rows.join('')}</ul>` : '';
  }

  async function weekData(end) {
    await loadIndex();
    const start = addDays(end, -6);
    const [a, b] = await Promise.all([snap(addDays(end, -7)), snap(end)]);
    const d = diff(a, b);
    const items = newsIn(start, end).sort((x, y) => y.date.localeCompare(x.date));
    const battles = W.mil.battles.filter((x) => inWindow(x.start, start, end)).sort((x, y) => y.start.localeCompare(x.start));
    const updated = b ? Object.entries(b.conflicts).filter(([, c]) => c[2] && inWindow(c[2], start, end)).map(([id, c]) => ({ id, name: c[3] })) : [];
    const counts = new Map();
    for (const n of items) for (const c of n.countries) counts.set(c, (counts.get(c) || 0) + 1);
    const hot = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
    return { start, end, d, items, battles, updated, hot, hasDiff: !!(a && b && a.date !== b.date) };
  }

  async function openWeek() {
    const w = await weekData(today);
    const cats = {};
    for (const n of w.items) cats[n.category] = (cats[n.category] || 0) + 1;
    const plural = (n, one, many) => `${n === 0 ? 'no' : n} ${n === 1 ? one : many}`;
    const lead = `${plural(w.items.length, 'story', 'stories')}, ${plural(w.battles.length, 'new battle or strike', 'new battles or strikes')} and ${plural(w.d.leaders.length, 'change of leader', 'changes of leader')}.`.replace(/^no/, 'No');
    W.openPanel({ hash: '#week', title: 'This week', html: `
      ${W.panelTop('This week', `${esc(W.fmtDate(w.start))} to ${esc(W.fmtDate(w.end))}`)}
      <p class="snapshot">${esc(lead)}</p>
      ${W.section('What changed', changeList(w.d) || `<p>${w.hasDiff ? 'No leader changed and no war changed its status or intensity.' : 'Daily snapshots began on 27 October 2026, so the comparison fills in as days pass.'}</p>`)}
      ${W.section('Most in the news', w.hot.length ? `<ol class="hot">${w.hot.map(([c, n]) => `<li>${countryBtn(c)} <span>${n} stor${n === 1 ? 'y' : 'ies'}</span></li>`).join('')}</ol>` : '')}
      ${W.section('Wars with new developments', w.updated.length ? `<ul class="war-rows">${w.updated.map((c) => `<li><button type="button" class="war-row" data-conflict="${c.id}"><span class="swatch" style="background:#B9473C"></span><span class="war-name">${esc(c.name)}</span></button></li>`).join('')}</ul>` : '')}
      ${W.section('New battles and strikes', w.battles.length ? battleRows(w.battles) : '')}
      ${W.section('Headlines', w.items.length ? newsRows(w.items.slice(0, 14)) + '<p class="more-link"><a href="news.html">All news</a></p>' : '')}
      <p class="sov-link"><button type="button" class="btn" data-tm-open="${today}">Open the time machine</button></p>` });
  }

  async function openDay(date) {
    const w = await weekData(date);
    const [y, m, d] = date.split('-').map(Number);
    const title = `${d} ${MONTHS[m - 1]} ${y}`;
    const active = W.mil.battles.filter((b) => battleActive(b, date)).sort((a, b) => b.start.localeCompare(a.start));
    W.openPanel({ hash: `#time/${date}`, title, html: `
      ${W.panelTop(title, 'The week up to this day')}
      ${W.section('What changed that week', changeList(w.d) || (w.hasDiff ? '<p>No leader changed and no war changed its status or intensity.</p>' : '<p>Daily snapshots of leaders and front lines begin on 27 October 2026.</p>'))}
      ${W.section('Headlines', w.items.length ? newsRows(w.items.slice(0, 12)) : '<p>The news archive begins on 12 October 2026.</p>')}
      ${W.section('Battles that began that week', w.battles.length ? battleRows(w.battles) : '')}
      ${W.section(`Fighting under way (${active.length})`, active.length ? battleRows(active.slice(0, 15)) : '')}` });
  }

  W.ext.routes.push((h) => {
    if (h === 'week') { openWeek(); return true; }
    const m = h.match(/^time\/(\d{4}-\d{2}-\d{2})$/);
    if (!m) return false;
    T = m[1];
    (on ? Promise.resolve() : setOn(true)).then(() => { setDate(m[1]); openDay(m[1]); });
    return true;
  });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tm-open]');
    if (b) { ev.preventDefault(); T = b.dataset.tmOpen; setOn(true); }
  });

  /* ---------- intro: this week, in brief ---------- */
  async function renderIntro() {
    const el = $('#intro-week');
    if (!el) return;
    const w = await weekData(today);
    const bits = [];
    for (const x of w.d.leaders) bits.push(`<li>New leader in ${countryBtn(x.cid)}: ${esc(x.to)}.</li>`);
    for (const x of w.d.conflicts.slice(0, 2)) bits.push(`<li><button type="button" class="link" data-conflict="${x.id}">${esc(x.name)}</button> is now ${esc(x.to)}.</li>`);
    if (w.hot.length) bits.push(`<li>Most in the news: ${w.hot.slice(0, 4).map(([c]) => countryBtn(c)).join(', ')}.</li>`);
    bits.push(`<li>${w.items.length} ${w.items.length === 1 ? 'story' : 'stories'} and ${w.battles.length} new ${w.battles.length === 1 ? 'battle or strike' : 'battles or strikes'} in the last seven days.</li>`);
    el.innerHTML = `<h2 class="intro-h">This week</h2><ul class="changes brief">${bits.join('')}</ul><p class="more-link"><a href="#week">Everything that changed this week</a></p>`;
  }

  W.on('ready', () => {
    const tools = $('#globe-tools');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'tm-btn';
    btn.className = 'tool';
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.2V8l2.6 1.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Time machine</span>';
    btn.title = 'Scrub the globe back through the past year';
    btn.addEventListener('click', () => setOn(!on));
    tools.insertBefore(btn, tools.firstChild);
    renderIntro();
  });
})();
