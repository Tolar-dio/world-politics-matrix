/* World Politics Matrix: globe, search, lenses and country profiles. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobileMQ = matchMedia('(max-width: 899px)');
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

  /* ---------- lenses ---------- */
  const TERRITORY_COLOR = () => cssVar('--land');
  const LENSES = {
    system: {
      title: 'System of government',
      key: (e) => e.system,
      items: [
        ['presidential', 'Presidential republic', '#E3A86B'],
        ['semi-presidential', 'Semi-presidential republic', '#E8C76A'],
        ['parliamentary', 'Parliamentary republic', '#8FB98B'],
        ['const-monarchy', 'Constitutional monarchy', '#B7A3CF'],
        ['exec-monarchy', 'Ruling monarchy', '#C77D8E'],
        ['one-party', 'One-party state', '#C9574A'],
        ['military', 'Military-led government', '#8A7B66'],
        ['religious', 'Clerical rule', '#4F8A8B'],
        ['contested', 'Divided or contested authority', '#A3A6A8'],
      ],
      none: ['Not classified yet', '#E4DED0'],
    },
    story: {
      title: 'What defined 2026',
      key: (e) => e.story,
      items: [
        ['war', 'War or armed conflict', '#B9473C'],
        ['election', 'Election or handover of power', '#E0B84F'],
        ['unrest', 'Protest, crackdown or political crisis', '#E08A4F'],
        ['shock', 'Economic or outside shock', '#9C8DB8'],
        ['steady', 'Steadier than most', '#A9BFA0'],
      ],
      none: ['Not tagged', '#E4DED0'],
    },
    tenure: {
      title: 'How long the leader has held power',
      key: (e) => e.tenure,
      items: [
        ['new', 'Took power in 2026', '#F2E3B6'],
        ['y1-3', 'Took power 2023 to 2025', '#E7BE72'],
        ['y4-10', 'Took power 2016 to 2022', '#D28C4B'],
        ['y11-20', 'Took power 2006 to 2015', '#A5533A'],
        ['y20plus', 'Took power before 2006', '#6B2D38'],
        ['collective', 'Collective leadership', '#AEB7BC'],
      ],
      none: ['Not recorded', '#E4DED0'],
    },
  };
  const YEAR = 2026;

  const state = {
    lens: 'system',
    selected: null,
    hovered: null,
    pointer: { x: 0, y: 0 },
    details: new Map(),
    sheet: 'peek',
  };

  let index, byId, features, world, lensColor;

  /* ---------- colour helpers ---------- */
  function mix(hex, toHex, amt) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(toHex.slice(1), 16);
    const ch = (sh) => Math.round(((a >> sh) & 255) * (1 - amt) + ((b >> sh) & 255) * amt);
    return '#' + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1);
  }

  function buildLensColor() {
    const map = new Map();
    for (const [lensName, lens] of Object.entries(LENSES)) {
      const m = new Map(lens.items.map(([k, , c]) => [k, c]));
      map.set(lensName, m);
    }
    return (entity) => {
      if (!entity) return TERRITORY_COLOR();
      if (entity.kind === 'territory') return TERRITORY_COLOR();
      const lens = LENSES[state.lens];
      const k = lens.key(entity);
      return (k && map.get(state.lens).get(k)) || lens.none[1];
    };
  }

  function lensLabel(entity) {
    if (!entity) return '';
    if (entity.kind === 'territory') return 'Territory or dependency';
    const lens = LENSES[state.lens];
    const k = lens.key(entity);
    const item = lens.items.find(([key]) => key === k);
    return item ? item[1] : lens.none[0];
  }

  /* ---------- globe ---------- */
  function oceanTexture() {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = cssVar('--ocean');
    g.fillRect(0, 0, c.width, c.height);
    const y = (lat) => ((90 - lat) / 180) * c.height;
    const x = (lng) => ((lng + 180) / 360) * c.width;
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1.4;
    for (let lng = -180; lng <= 180; lng += 15) { g.beginPath(); g.moveTo(x(lng), 0); g.lineTo(x(lng), c.height); g.stroke(); }
    for (let lat = -75; lat <= 75; lat += 15) { g.beginPath(); g.moveTo(0, y(lat)); g.lineTo(c.width, y(lat)); g.stroke(); }
    g.setLineDash([10, 8]);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    for (const lat of [23.44, -23.44, 66.56, -66.56]) { g.beginPath(); g.moveTo(0, y(lat)); g.lineTo(c.width, y(lat)); g.stroke(); }
    g.setLineDash([]);
    g.strokeStyle = 'rgba(232,199,106,0.55)';
    g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(0, y(0)); g.lineTo(c.width, y(0)); g.stroke();
    return c.toDataURL('image/png');
  }

  function isDark() {
    const forced = document.documentElement.dataset.theme;
    return forced ? forced === 'dark' : darkMQ.matches;
  }

  function capColor(f) {
    const id = f.properties.id;
    const e = id && byId.get(id);
    if (id && id === state.selected) return isDark() ? '#F3EBDA' : '#1F2A33';
    const base = lensColor(e);
    if (id && id === state.hovered) return mix(base, '#1F2A33', 0.18);
    return base;
  }

  function altitude(f) {
    const id = f.properties.id;
    if (!id) return 0.004;
    if (id === state.selected) return 0.045;
    if (id === state.hovered) return 0.02;
    return 0.008;
  }

  function refreshPolygons() {
    if (!world) return;
    world.polygonCapColor(capColor).polygonAltitude(altitude).polygonSideColor(world.polygonSideColor());
    document.querySelectorAll('.micro').forEach((el) => {
      const e = byId.get(el.dataset.id);
      el.style.background = lensColor(e);
      el.classList.toggle('is-selected', el.dataset.id === state.selected);
    });
  }

  function applyTheme() {
    if (!world) return;
    world
      .globeImageUrl(oceanTexture())
      .atmosphereColor(isDark() ? '#4f7690' : '#ffffff')
      .polygonSideColor((f) => (f.properties.id && f.properties.id === state.selected ? cssVar('--brass') : (isDark() ? 'rgba(10,16,20,0.55)' : 'rgba(31,42,51,0.28)')))
      .polygonStrokeColor(() => (isDark() ? 'rgba(10,16,20,0.7)' : 'rgba(31,42,51,0.42)'));
    refreshPolygons();
    drawMeridian();
  }

  function initGlobe(el) {
    world = new Globe(el, { rendererConfig: { antialias: true, alpha: true }, animateIn: !reduceMotion })
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereAltitude(0.13)
      .polygonsData(features)
      .polygonCapCurvatureResolution(3)
      .polygonsTransitionDuration(reduceMotion ? 0 : 260)
      .polygonLabel(() => '')
      .onPolygonHover((f) => setHover(f && f.properties.id))
      .onPolygonClick((f) => { if (f && f.properties.id) select(f.properties.id); })
      .htmlElementsData(index.entities.filter((e) => e.tiny && e.kind === 'country'))
      .htmlLat('lat').htmlLng('lng').htmlAltitude(0.012)
      .htmlElement(microMarker)
      .htmlElementVisibilityModifier((elem, visible) => { elem.style.visibility = visible ? 'visible' : 'hidden'; })
      .onZoom(() => scheduleMeridian());

    // Brighter, flatter light so the atlas colours read true.
    const lights = world.lights();
    lights.forEach((l) => {
      if (l.type === 'AmbientLight') l.intensity = Math.PI * 0.95;
      if (l.type === 'DirectionalLight') l.intensity = Math.PI * 0.55;
    });

    const controls = world.controls();
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.35;
    controls.minDistance = 130;
    controls.maxDistance = 900;
    controls.addEventListener('start', () => { controls.autoRotate = false; });

    sizeGlobe();
    applyTheme();
    const startAlt = mobileMQ.matches ? 3.0 : 2.3;
    world.pointOfView({ lat: 18, lng: 12, altitude: startAlt + (reduceMotion ? 0 : 1.2) }, 0);
    world.onGlobeReady(() => {
      $('#loading').hidden = true;
      if (!reduceMotion && !state.selected) world.pointOfView({ altitude: startAlt }, 1800);
    });
  }

  function sizeGlobe() {
    if (!world) return;
    const el = $('#globe');
    world.width(el.clientWidth).height(el.clientHeight);
    scheduleMeridian();
  }

  function microMarker(e) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'micro';
    b.dataset.id = e.id;
    b.setAttribute('aria-label', e.name);
    b.style.background = lensColor(e);
    b.addEventListener('mouseenter', () => setHover(e.id));
    b.addEventListener('mouseleave', () => setHover(null));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); select(e.id); });
    return b;
  }

  /* ---------- meridian ring (the brass ring of a classroom globe) ---------- */
  let meridianQueued = false;
  function scheduleMeridian() {
    if (meridianQueued) return;
    meridianQueued = true;
    requestAnimationFrame(() => { meridianQueued = false; drawMeridian(); });
  }

  function drawMeridian() {
    const svg = $('#meridian');
    if (!world) return;
    const el = $('#globe');
    const w = el.clientWidth, h = el.clientHeight;
    const pov = world.pointOfView();
    const d = 1 + pov.altitude;
    const fov = (world.camera().fov * Math.PI) / 180;
    const r = ((h / 2) * (1 / Math.sqrt(d * d - 1))) / Math.tan(fov / 2);
    const [ox, oy] = world.globeOffset();
    const cx = w / 2 + ox, cy = h / 2 + oy;
    const ring = r + Math.max(9, r * 0.055);
    if (ring > Math.max(w, h) * 1.3) { svg.innerHTML = ''; return; }
    const brass = cssVar('--brass');
    const tilt = -23.44;
    const ticks = [];
    for (let deg = 0; deg < 360; deg += 5) {
      const long = deg % 30 === 0;
      const a = ((deg + tilt) * Math.PI) / 180;
      const r1 = ring + 2, r2 = ring + (long ? 9 : 5);
      ticks.push(`<line x1="${(cx + r1 * Math.cos(a)).toFixed(1)}" y1="${(cy + r1 * Math.sin(a)).toFixed(1)}" x2="${(cx + r2 * Math.cos(a)).toFixed(1)}" y2="${(cy + r2 * Math.sin(a)).toFixed(1)}" stroke-width="${long ? 1.4 : 0.9}"/>`);
    }
    const axis = ((tilt - 90) * Math.PI) / 180;
    const px = (sign) => (cx + sign * ring * Math.cos(axis)).toFixed(1);
    const py = (sign) => (cy + sign * ring * Math.sin(axis)).toFixed(1);
    svg.innerHTML = `
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${ring.toFixed(1)}" fill="none" stroke="${brass}" stroke-width="3.2" opacity="0.9"/>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(ring - 2.6).toFixed(1)}" fill="none" stroke="${brass}" stroke-width="0.8" opacity="0.5"/>
      <g stroke="${brass}" opacity="0.75">${ticks.join('')}</g>
      <circle cx="${px(1)}" cy="${py(1)}" r="4.2" fill="${brass}"/>
      <circle cx="${px(-1)}" cy="${py(-1)}" r="4.2" fill="${brass}"/>`;
  }

  /* ---------- hover tooltip ---------- */
  const tip = $('#tip');
  function setHover(id) {
    if (state.hovered === id) return;
    state.hovered = id || null;
    refreshPolygons();
    renderTip();
  }

  function renderTip() {
    const e = state.hovered && byId.get(state.hovered);
    if (!e || mobileMQ.matches) { tip.hidden = true; return; }
    const color = lensColor(e);
    const snap = e.kind === 'territory' ? e.note : e.snapshot;
    tip.innerHTML = `
      <div class="tip-name">${esc(e.flag)} ${esc(e.name)}</div>
      <div class="tip-key"><span class="swatch" style="background:${color}"></span>${esc(state.lens === 'tenure' && e.kind === 'country' ? tenureLine(e) : lensLabel(e))}</div>
      ${snap ? `<div class="tip-snap">${esc(snap)}</div>` : ''}`;
    tip.hidden = false;
    placeTip();
  }

  function tenureLine(e) {
    if (e.since == null) return e.leader || 'Collective leadership';
    const yrs = YEAR - e.since;
    return `${e.leader}, since ${e.since}${yrs >= 2 ? ` (${yrs} years)` : ''}`;
  }

  function placeTip() {
    if (tip.hidden) return;
    const pad = 16;
    const { x, y } = state.pointer;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + pad, top = y + pad;
    if (left + w > innerWidth - 8) left = x - w - pad;
    if (top + h > innerHeight - 8) top = y - h - pad;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }

  /* ---------- legend + lens ---------- */
  function renderLegend() {
    const lens = LENSES[state.lens];
    const counts = new Map();
    let noneCount = 0;
    for (const e of index.entities) {
      if (e.kind !== 'country') continue;
      const k = lens.key(e);
      if (k && lens.items.some(([key]) => key === k)) counts.set(k, (counts.get(k) || 0) + 1);
      else noneCount += 1;
    }
    const rows = lens.items
      .filter(([k]) => counts.get(k))
      .map(([k, label, color]) => `<li><span class="swatch" style="background:${color}"></span>${esc(label)} <span class="n">${counts.get(k)}</span></li>`);
    if (noneCount) rows.push(`<li><span class="swatch" style="background:${lens.none[1]}"></span>${esc(lens.none[0])} <span class="n">${noneCount}</span></li>`);
    rows.push(`<li><span class="swatch" style="background:${TERRITORY_COLOR()}"></span>Territory or dependency</li>`);
    $('#legend').innerHTML = rows.join('');
    $('#legend-title').textContent = lens.title;
  }

  function setLens(name) {
    state.lens = name;
    document.querySelectorAll('.lens-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lens === name)));
    renderLegend();
    refreshPolygons();
    refreshBrowseDots();
    renderTip();
    try { localStorage.setItem('wpm-lens', name); } catch (_) { /* storage unavailable */ }
  }

  /* ---------- search ---------- */
  const input = $('#search');
  const results = $('#search-results');
  let matches = [], active = -1;

  function runSearch(q) {
    const n = norm(q);
    if (!n) return [];
    const scored = [];
    for (const e of index.entities) {
      const name = norm(e.name);
      const words = e.name.toLowerCase().split(/[\s-]+/).map(norm);
      let score = null;
      if (name.startsWith(n)) score = 0;
      else if (words.some((w) => w.startsWith(n))) score = 1;
      else if ((e.aka || []).some((a) => a.startsWith(n)) || norm(e.id) === n) score = 2;
      else if (n.length > 2 && name.includes(n)) score = 3;
      if (score !== null) scored.push([score, e]);
    }
    scored.sort((a, b) => a[0] - b[0] || (a[1].kind === 'country' ? -1 : 1) - (b[1].kind === 'country' ? -1 : 1) || a[1].name.localeCompare(b[1].name));
    return scored.slice(0, 8).map(([, e]) => e);
  }

  function renderResults() {
    if (!input.value.trim()) { results.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    if (!matches.length) {
      results.innerHTML = `<li class="empty" role="option" aria-disabled="true">No country matches “${esc(input.value.trim())}”</li>`;
    } else {
      results.innerHTML = matches.map((e, i) => {
        const meta = e.kind === 'territory' ? 'Territory' : esc(e.subregion || e.region || '');
        return `<li role="option" id="opt-${e.id}" data-id="${e.id}" aria-selected="${i === active}"><span class="flag">${esc(e.flag)}</span><span>${esc(e.name)}</span><span class="meta">${meta}</span></li>`;
      }).join('');
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', active >= 0 && matches[active] ? `opt-${matches[active].id}` : '');
  }

  function closeResults() { results.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }

  function initSearch() {
    input.addEventListener('input', () => { matches = runSearch(input.value); active = matches.length ? 0 : -1; renderResults(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' && matches.length) { active = (active + 1) % matches.length; renderResults(); ev.preventDefault(); }
      else if (ev.key === 'ArrowUp' && matches.length) { active = (active - 1 + matches.length) % matches.length; renderResults(); ev.preventDefault(); }
      else if (ev.key === 'Enter' && matches[active]) { pick(matches[active].id); ev.preventDefault(); }
      else if (ev.key === 'Escape') { if (input.value) { input.value = ''; closeResults(); } else input.blur(); ev.stopPropagation(); }
    });
    input.addEventListener('blur', () => setTimeout(closeResults, 150));
    input.addEventListener('focus', () => { if (input.value.trim()) { matches = runSearch(input.value); renderResults(); } });
    results.addEventListener('mousedown', (ev) => {
      const li = ev.target.closest('li[data-id]');
      if (li) { ev.preventDefault(); pick(li.dataset.id); }
    });
    function pick(id) { input.value = ''; closeResults(); input.blur(); select(id); }
  }

  /* ---------- intro panel ---------- */
  const BROWSE_GROUPS = ['Africa', 'Americas', 'Asia', 'Middle East', 'Europe', 'Oceania'];

  function renderIntro() {
    const c = index.counts;
    const countries = index.entities.filter((e) => e.kind === 'country');
    $('#intro-count').textContent = `All ${c.countries} countries, from China to Tuvalu, updated ${index.checked}.`;

    // The year at a glance: storyline counts with the biggest examples
    const byPop = (a, b) => (b.pop || 0) - (a.pop || 0);
    $('#glance').innerHTML = LENSES.story.items.map(([key, label, color]) => {
      const list = countries.filter((e) => e.story === key).sort(byPop);
      if (!list.length) return '';
      const eg = list.slice(0, 3).map((e) => `<button type="button" class="link" data-id="${e.id}">${esc(e.name)}</button>`).join(', ');
      return `<li><button type="button" class="glance-row" data-lens="story"><span class="swatch" style="background:${color}"></span><span class="glance-label">${esc(label)}</span><span class="glance-n">${list.length}</span></button><p class="glance-eg">Including ${eg}</p></li>`;
    }).join('');

    // Longest in power
    const longest = countries.filter((e) => e.since != null).sort((a, b) => a.since - b.since || a.name.localeCompare(b.name)).slice(0, 8);
    $('#longest').innerHTML = longest.map((e) =>
      `<li><button type="button" data-id="${e.id}"><span class="lp-year">${e.since}</span><span class="lp-who"><b>${esc(e.leader)}</b><span>${esc(e.flag)} ${esc(e.name)}</span></span></button></li>`).join('');

    const groups = new Map(BROWSE_GROUPS.map((g) => [g, []]));
    for (const e of countries) (groups.get(e.group) || groups.get('Asia')).push(e);
    $('#browse').innerHTML = BROWSE_GROUPS.map((g) => {
      const list = groups.get(g).sort((a, b) => a.name.localeCompare(b.name));
      return `<details><summary>${g} <span>${list.length} countries</span></summary><ul>${list.map((e) =>
        `<li><button type="button" data-id="${e.id}"><span class="dot" style="background:${lensColor(e)}" aria-hidden="true"></span>${esc(e.name)}</button></li>`).join('')}</ul></details>`;
    }).join('');

    $('#intro').addEventListener('click', (ev) => {
      const pick = ev.target.closest('button[data-id]');
      if (pick) { select(pick.dataset.id); return; }
      const row = ev.target.closest('button[data-lens]');
      if (row) setLens(row.dataset.lens);
    });
  }

  function refreshBrowseDots() {
    document.querySelectorAll('#browse button[data-id] .dot').forEach((dot) => {
      dot.style.background = lensColor(byId.get(dot.parentElement.dataset.id));
    });
  }

  /* ---------- profile panel ---------- */
  async function loadDetail(id) {
    if (state.details.has(id)) return state.details.get(id);
    const res = await fetch(`data/countries/${id}.json`);
    if (!res.ok) throw new Error(`Couldn't load ${id}`);
    const d = await res.json();
    state.details.set(id, d);
    return d;
  }

  const CLOSE_ICON = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function systemLabel(key) {
    const item = LENSES.system.items.find(([k]) => k === key);
    return item ? { label: item[1], color: item[2] } : null;
  }

  function tenureLabel(since) {
    const item = LENSES.tenure.items.find(([k]) => k === bucketFor(since));
    return item ? item[2] : '#AEB7BC';
  }

  function bucketFor(since) {
    if (since == null) return 'collective';
    if (since >= 2026) return 'new';
    if (since >= 2023) return 'y1-3';
    if (since >= 2016) return 'y4-10';
    if (since >= 2006) return 'y11-20';
    return 'y20plus';
  }

  function renderProfile(d) {
    const f = d.facts || {};
    const sys = systemLabel(d.system);
    const where = [d.subregion || d.region, d.official && d.official !== d.name ? d.official : null].filter(Boolean).join('. ');
    const fact = (label, val, wide) => (val ? `<div${wide ? ' class="wide"' : ''}><dt>${label}</dt><dd>${val}</dd></div>` : '');
    const sec = (title, inner, extra = '') => (inner ? `<section><h2>${title}</h2>${extra}${inner}</section>` : '');
    const paras = (list) => (list && list.length ? list.map((p) => `<p>${p}</p>`).join('') : '');

    let holders = '';
    if (d.holders) holders = `<p>${d.holders}</p>`;
    else if (d.leaders) {
      const L = d.leaders;
      holders = `${L.state ? `<p>${esc(L.state)}</p>` : ''}${L.gov && L.gov !== L.state ? `<p>${esc(L.gov)}</p>` : ''}`;
    }
    const yrs = d.since != null ? YEAR - d.since : null;
    const span = yrs == null ? 'Collective leadership' : yrs < 1 ? 'New in 2026' : yrs === 1 ? `One year in power, since ${d.since}` : `${yrs} years in power, since ${d.since}`;
    const tenure = `<p class="tenure"><span class="swatch" style="background:${tenureLabel(d.since)}"></span>${span}</p>`;
    holders = `<div class="holders">${holders}${tenure}</div>`;

    const status = d.depth === 'full'
      ? `<p class="status">Current to ${esc(d.current_to)}${d.update ? `, updated ${esc(d.update.date)}` : ''}</p>`
      : `<p class="status short">Short profile, checked ${esc(d.current_to)}</p>`;

    const update = d.update ? `<div class="update"><p><b>Update, ${esc(d.update.date)}.</b> ${d.update.html}</p></div>` : '';

    const sources = d.sources && d.sources.length
      ? `<ol class="sources">${d.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ol>`
      : '';

    $('#profile').innerHTML = `
      <div class="profile-top">
        <div>
          <span class="profile-flag" aria-hidden="true">${esc(d.flag)}</span>
          <h2 class="profile-name" id="profile-name" tabindex="-1">${esc(d.name)}</h2>
          <p class="profile-where">${esc(where)}</p>
        </div>
        <button class="close" type="button" id="close-btn" aria-label="Close profile">${CLOSE_ICON}</button>
      </div>
      ${d.snapshot ? `<p class="snapshot">${esc(d.snapshot)}</p>` : ''}
      ${status}
      <dl class="facts">
        ${fact('Capital', esc(f.capital))}
        ${fact('Population', esc(f.population))}
        ${fact('Area', esc(f.area))}
        ${fact('Currency', esc(f.currency))}
        ${fact('Languages', esc(f.languages), true)}
        ${fact('Religion', esc(f.religion), true)}
        ${fact('System', sys ? `<span class="system-key"><span class="swatch" style="background:${sys.color}"></span>${esc(sys.label)}</span>${d.system_note ? `. ${esc(d.system_note)}` : ''}` : '', true)}
        ${fact('Who holds power', holders, true)}
      </dl>
      ${d.tags && d.tags.length ? `<ul class="tags" aria-label="Descriptors">${d.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${sec('Where things stand', update + paras(d.situation))}
      ${d.power ? sec('How power works', `<p class="power">${d.power}</p>`) : ''}
      ${sec('Culture', paras(d.culture))}
      ${sec('Society', paras(d.society))}
      ${sec('Sources', sources)}`;

    $('#profile').querySelectorAll('section a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    $('#close-btn').addEventListener('click', closeProfile);
  }

  function renderTerritory(e) {
    const sov = byId.get(e.sovereign);
    $('#profile').innerHTML = `
      <div class="profile-top">
        <div>
          <span class="profile-flag" aria-hidden="true">${esc(e.flag)}</span>
          <h2 class="profile-name" id="profile-name" tabindex="-1">${esc(e.name)}</h2>
          <p class="profile-where">${sov ? `Territory of ${esc(sov.name)}` : 'Territory'}</p>
        </div>
        <button class="close" type="button" id="close-btn" aria-label="Close profile">${CLOSE_ICON}</button>
      </div>
      <p class="snapshot">${esc(e.note)}</p>
      ${sov ? `<p class="sov-link"><button class="btn" type="button" id="sov-btn">Open ${esc(sov.name)}</button></p>` : ''}`;
    $('#close-btn').addEventListener('click', closeProfile);
    const sb = $('#sov-btn');
    if (sb) sb.addEventListener('click', () => select(sov.id));
  }

  /* ---------- selection ---------- */
  async function select(id, { fly = true } = {}) {
    const e = byId.get(id);
    if (!e) return;
    state.selected = id;
    if (world) world.controls().autoRotate = false;
    refreshPolygons();
    if (fly) flyTo(e);
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    document.title = `${e.name}, World Politics Matrix`;

    $('#intro').hidden = true;
    $('#profile').hidden = false;
    if (e.kind === 'territory') {
      renderTerritory(e);
    } else {
      $('#profile').innerHTML = `<p class="lead-in">Loading ${esc(e.name)}</p>`;
      try {
        const d = await loadDetail(id);
        if (state.selected !== id) return;
        renderProfile(d);
      } catch (err) {
        $('#profile').innerHTML = `<p>Couldn't load the profile for ${esc(e.name)}. Check your connection and pick the country again.</p>`;
      }
    }
    $('#sheet-scroll').scrollTop = 0;
    setSheet(mobileMQ.matches ? (state.sheet === 'full' ? 'full' : 'open') : 'open');
    const heading = $('#profile-name');
    if (heading && !mobileMQ.matches) heading.focus({ preventScroll: true });
  }

  function closeProfile() {
    state.selected = null;
    refreshPolygons();
    $('#profile').hidden = true;
    $('#intro').hidden = false;
    history.replaceState(null, '', location.pathname + location.search);
    document.title = 'World Politics Matrix';
    setSheet('peek');
  }

  function flyTo(e) {
    if (!world) return;
    const area = e.area || 40000;
    let alt = Math.min(2.4, Math.max(1.1, 0.9 + Math.sqrt(area) / 1400));
    if (mobileMQ.matches) alt += 0.55;
    world.pointOfView({ lat: e.lat, lng: e.lng, altitude: alt }, reduceMotion ? 0 : 1100);
  }

  /* ---------- sheet (bottom sheet on phones) ---------- */
  let offsetAnim = null;
  function setSheet(next) {
    state.sheet = next;
    const sheet = $('#sheet');
    sheet.dataset.state = next;
    $('#sheet-handle').setAttribute('aria-label', next === 'full' ? 'Shrink panel' : 'Expand panel');
    if (!world) return;
    const target = mobileMQ.matches && next !== 'peek' ? -Math.round($('#globe').clientHeight * 0.2) : 0;
    const from = world.globeOffset()[1];
    if (offsetAnim) cancelAnimationFrame(offsetAnim);
    if (reduceMotion || from === target) { world.globeOffset([0, target]); scheduleMeridian(); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 320);
      const ease = 1 - Math.pow(1 - k, 3);
      world.globeOffset([0, from + (target - from) * ease]);
      drawMeridian();
      if (k < 1) offsetAnim = requestAnimationFrame(step);
    };
    offsetAnim = requestAnimationFrame(step);
  }

  function initSheet() {
    const handle = $('#sheet-handle');
    let startY = null, moved = false;
    handle.addEventListener('pointerdown', (ev) => { startY = ev.clientY; moved = false; handle.setPointerCapture(ev.pointerId); });
    handle.addEventListener('pointermove', (ev) => { if (startY !== null && Math.abs(ev.clientY - startY) > 8) moved = true; });
    handle.addEventListener('pointerup', (ev) => {
      if (startY === null) return;
      const dy = ev.clientY - startY;
      startY = null;
      const order = ['peek', 'open', 'full'];
      let i = order.indexOf(state.sheet);
      if (!moved) i = state.sheet === 'full' ? (state.selected ? 1 : 0) : 2;
      else if (dy < -30) i = Math.min(2, i + 1);
      else if (dy > 30) i = Math.max(0, i - 1);
      setSheet(order[i]);
    });
    $('#sheet').addEventListener('click', (ev) => {
      if (mobileMQ.matches && state.sheet === 'peek' && !ev.target.closest('button, a')) setSheet(state.selected ? 'open' : 'full');
    });
  }

  /* ---------- boot ---------- */
  async function boot() {
    const [idx, topo] = await Promise.all([
      fetch('data/index.json').then((r) => r.json()),
      fetch('data/world.topo.json').then((r) => r.json()),
    ]);
    index = idx;
    byId = new Map(index.entities.map((e) => [e.id, e]));
    lensColor = buildLensColor();
    features = topojson.feature(topo, topo.objects.countries).features;

    try { const saved = localStorage.getItem('wpm-lens'); if (saved && LENSES[saved]) state.lens = saved; } catch (_) { /* storage unavailable */ }

    renderIntro();
    initSearch();
    initSheet();
    initGlobe($('#globe'));
    setLens(state.lens);

    document.querySelectorAll('.lens-switch button').forEach((b) => b.addEventListener('click', () => setLens(b.dataset.lens)));
    $('#random-btn').addEventListener('click', () => {
      const pool = index.entities.filter((e) => e.kind === 'country');
      select(pool[Math.floor(Math.random() * pool.length)].id);
    });
    $('#home-link').addEventListener('click', (ev) => { ev.preventDefault(); closeProfile(); });

    new ResizeObserver(sizeGlobe).observe($('#globe'));
    $('#stage').addEventListener('pointermove', (ev) => { state.pointer = { x: ev.clientX, y: ev.clientY }; placeTip(); });
    $('#stage').addEventListener('pointerleave', () => setHover(null));
    darkMQ.addEventListener('change', applyTheme);
    mobileMQ.addEventListener('change', () => setSheet(state.sheet));

    document.addEventListener('keydown', (ev) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (ev.key === '/' && !typing) { ev.preventDefault(); input.focus(); }
      else if (ev.key === 'Escape' && !typing && state.selected) closeProfile();
    });
    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1).toUpperCase();
      if (byId.has(id) && id !== state.selected) select(id);
    });

    const fromHash = location.hash.slice(1).toUpperCase();
    if (byId.has(fromHash)) select(fromHash);
  }

  boot().catch((err) => {
    console.error(err);
    const l = $('#loading');
    l.hidden = false;
    l.textContent = 'The map data failed to load. Reload the page to try again.';
  });
})();
