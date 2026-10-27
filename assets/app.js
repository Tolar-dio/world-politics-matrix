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
    mode: 'politics',          // 'politics' | 'conflict'
    layers: { zones: true, lines: true, battles: true, bases: true },
    majorOnly: false,
    hoverMil: null,            // {type: 'conflict'|'battle'|'base', id}
    focus: null,               // selected military object {type, id}
    conflictDetails: new Map(),
  };

  let index, byId, features, world, lensColor;
  let mil = { conflicts: [], battles: [], bases: [] };
  let news = { items: [], upcoming: [] };
  let conflictById = new Map(), battleById = new Map(), baseById = new Map();
  let zoneFeatures = [];

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

  const WAR_FILL = { 3: '#B9473C', 2: '#E08A4F', 1: '#E8C76A' };
  const WAR_TINT = { 3: '#E7B4A8', 2: '#EDCBA6', 1: '#EEE0B4' };
  const WAR_TINT_DARK = { 3: '#7A3A33', 2: '#7A5236', 1: '#6E6338' };
  const ZONE_FILL = { high: 'rgba(170,52,40,0.62)', medium: 'rgba(214,118,52,0.6)', low: 'rgba(214,170,60,0.6)' };
  const ZONE_EDGE = { high: 'rgba(120,30,24,0.85)', medium: 'rgba(150,72,28,0.8)', low: 'rgba(140,110,30,0.8)' };

  function capColor(f) {
    if (f.properties.zone) {
      const z = f.properties;
      const hot = (state.hoverMil && state.hoverMil.type === 'conflict' && state.hoverMil.id === z.conflict)
        || (state.focus && state.focus.type === 'conflict' && state.focus.id === z.conflict);
      return hot ? ZONE_EDGE[z.intensity] : ZONE_FILL[z.intensity];
    }
    const id = f.properties.id;
    const e = id && byId.get(id);
    if (id && id === state.selected) return isDark() ? '#F3EBDA' : '#1F2A33';
    const base = state.mode === 'conflict' ? warColor(e) : lensColor(e);
    if (id && id === state.hovered) return mix(base, '#1F2A33', 0.18);
    return base;
  }

  function warColor(e) {
    if (!e || e.kind === 'territory' || !e.war) return cssVar('--quiet');
    return (isDark() ? WAR_TINT_DARK : WAR_TINT)[e.war] || cssVar('--quiet');
  }

  function altitude(f) {
    if (f.properties.zone) return 0.011 + f.properties.order * 0.0004;
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
      el.style.background = state.mode === 'conflict' ? warColor(e) : lensColor(e);
      el.classList.toggle('is-selected', el.dataset.id === state.selected);
    });
    document.querySelectorAll('.mk').forEach((el) => {
      el.classList.toggle('is-selected', !!state.focus && state.focus.type === el.dataset.type && state.focus.id === el.dataset.id);
    });
  }

  function applyTheme() {
    if (!world) return;
    world
      .globeImageUrl(oceanTexture())
      .atmosphereColor(isDark() ? '#4f7690' : '#ffffff')
      .polygonSideColor((f) => (f.properties.zone ? 'rgba(0,0,0,0)' : f.properties.id && f.properties.id === state.selected ? cssVar('--brass') : (isDark() ? 'rgba(10,16,20,0.55)' : 'rgba(31,42,51,0.28)')))
      .polygonStrokeColor((f) => (f.properties.zone ? ZONE_EDGE[f.properties.intensity] : isDark() ? 'rgba(10,16,20,0.7)' : 'rgba(31,42,51,0.42)'));
    refreshPolygons();
    drawMeridian();
  }

  function initGlobe(el) {
    world = new Globe(el, { rendererConfig: { antialias: true, alpha: true }, animateIn: !reduceMotion })
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereAltitude(0.13)
      .polygonsData(currentFeatures())
      .polygonCapCurvatureResolution(3)
      .polygonsTransitionDuration(reduceMotion ? 0 : 260)
      .polygonLabel(() => '')
      .onPolygonHover((f) => {
        if (f && f.properties.zone) { setHover(null); setHoverMil({ type: 'conflict', id: f.properties.conflict, zone: f.properties.name }); }
        else { setHoverMil(null); setHover(f && f.properties.id); }
      })
      .onPolygonClick((f) => {
        if (!f) return;
        if (f.properties.zone) openConflict(f.properties.conflict);
        else if (f.properties.id) select(f.properties.id);
      })
      .htmlElementsData(htmlData())
      .htmlLat('lat').htmlLng('lng').htmlAltitude((d) => (d.__type === 'micro' ? 0.012 : 0.02))
      .htmlElement(markerFor)
      .pathsData([])
      .pathPoints('points').pathPointLat((p) => p[0]).pathPointLng((p) => p[1])
      .pathColor(() => ['#3B0F0B', '#9B2A1F'])
      .pathStroke(3)
      .pathPointAlt(0.016)
      .pathDashLength(reduceMotion ? 1 : 0.035).pathDashGap(reduceMotion ? 0 : 0.012)
      .pathDashAnimateTime(reduceMotion ? 0 : 14000)
      .pathTransitionDuration(0)
      .onPathHover((p) => setHoverMil(p ? { type: 'conflict', id: p.conflict, line: p.name } : null))
      .onPathClick((p) => p && openConflict(p.conflict))
      .ringsData([])
      .ringColor(() => (t) => `rgba(185,71,60,${Math.max(0, 0.55 * (1 - t))})`)
      .ringMaxRadius('maxR').ringPropagationSpeed('speed').ringRepeatPeriod(2200).ringAltitude(0.0125)
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

  function htmlData() {
    if (state.mode !== 'conflict') return index.entities.filter((e) => e.tiny && e.kind === 'country').map((e) => ({ ...e, __type: 'micro' }));
    const out = [];
    if (state.layers.battles) for (const b of mil.battles) if (!state.majorOnly || b.tier === 'major') out.push({ ...b, __type: 'battle' });
    if (state.layers.bases) for (const b of mil.bases) out.push({ ...b, __type: 'base' });
    return out;
  }

  const SWORDS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13M2.2 9.6l4.2 4.2M9.6 13.8l4.2-4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none"/></svg>';

  const DIAMOND = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5L14.5 8 8 14.5 1.5 8z" fill="rgba(31,42,51,.35)" stroke="#F3D27A" stroke-width="2.2"/></svg>';

  function markerFor(d) {
    if (d.__type === 'micro') return microMarker(d);
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.type = d.__type;
    b.dataset.id = d.id;
    if (d.__type === 'battle') {
      b.className = `mk mk-battle ${d.tier}`;
      b.innerHTML = SWORDS;
      b.setAttribute('aria-label', `${d.name}, ${d.start}`);
    } else {
      const choke = d.kind === 'chokepoint' || d.kind === 'contested-feature';
      b.className = `mk mk-base ${choke ? 'choke' : ''} ${d.tier}`;
      if (choke) b.innerHTML = DIAMOND;
      b.setAttribute('aria-label', d.name);
    }
    if (state.focus && state.focus.type === d.__type && state.focus.id === d.id) b.classList.add('is-selected');
    b.addEventListener('mouseenter', () => setHoverMil({ type: d.__type, id: d.id }));
    b.addEventListener('mouseleave', () => setHoverMil(null));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); d.__type === 'battle' ? openBattle(d.id) : openBase(d.id); });
    return b;
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

  function setHoverMil(h) {
    const same = (a, b) => (!a && !b) || (a && b && a.type === b.type && a.id === b.id);
    if (same(state.hoverMil, h)) { if (h) { state.hoverMil = h; renderTip(); } return; }
    const touchesZones = (x) => x && x.type === 'conflict';
    const refresh = touchesZones(state.hoverMil) || touchesZones(h);
    state.hoverMil = h;
    if (refresh) refreshPolygons();
    renderTip();
  }

  function milTip(h) {
    if (h.type === 'conflict') {
      const c = conflictById.get(h.id);
      if (!c) return '';
      const where = h.zone ? `<div class="tip-key">${esc(h.zone)}</div>` : h.line ? `<div class="tip-key">${esc(h.line)}</div>` : '';
      return `<div class="tip-name">${esc(c.name)}</div>${where}<div class="tip-key"><span class="swatch" style="background:${WAR_FILL[{ high: 3, medium: 2, low: 1 }[c.intensity]]}"></span>${esc(INTENSITY_LABEL[c.intensity])}, ${esc(STATUS_LABEL[c.status])}</div><div class="tip-snap">${c.summary}</div>`;
    }
    if (h.type === 'battle') {
      const b = battleById.get(h.id);
      if (!b) return '';
      const c = conflictById.get(b.conflict);
      return `<div class="tip-name">${esc(b.name)}</div><div class="tip-key">${esc(dateRange(b.start, b.end))}${b.place ? `. ${esc(b.place)}` : ''}</div><div class="tip-key">${b.tier === 'major' ? 'Major battle' : 'Mid-size engagement'}${c ? ` in ${esc(c.name)}` : ''}</div>`;
    }
    const b = baseById.get(h.id);
    if (!b) return '';
    return `<div class="tip-name">${esc(b.name)}</div><div class="tip-key">${esc(KIND_LABEL[b.kind] || b.kind)}${b.operators.length ? `. ${esc(b.operators.slice(0, 3).join(', '))}` : ''}</div>${b.why ? `<div class="tip-snap">${b.why}</div>` : ''}`;
  }

  function renderTip() {
    if (state.hoverMil && !mobileMQ.matches) {
      const html = milTip(state.hoverMil);
      if (html) { tip.innerHTML = html; tip.hidden = false; placeTip(); return; }
    }
    const e = state.hovered && byId.get(state.hovered);
    if (!e || mobileMQ.matches) { tip.hidden = true; return; }
    const color = state.mode === 'conflict' ? warColor(e) : lensColor(e);
    const snap = e.kind === 'territory' ? e.note : e.snapshot;
    tip.innerHTML = `
      <div class="tip-name">${esc(e.flag)} ${esc(e.name)}</div>
      <div class="tip-key"><span class="swatch" style="background:${color}"></span>${esc(state.mode === 'conflict' ? warLine(e) : state.lens === 'tenure' && e.kind === 'country' ? tenureLine(e) : lensLabel(e))}</div>
      ${snap ? `<div class="tip-snap">${esc(snap)}</div>` : ''}`;
    tip.hidden = false;
    placeTip();
  }

  function warLine(e) {
    if (!e || e.kind !== 'country') return 'Territory or dependency';
    const list = mil.conflicts.filter((c) => c.countries.includes(e.id));
    if (!list.length) return 'No active armed conflict on its soil';
    return list.slice(0, 2).map((c) => c.name).join('; ') + (list.length > 2 ? ` and ${list.length - 2} more` : '');
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
      const e = byId.get(dot.parentElement.dataset.id);
      dot.style.background = state.mode === 'conflict' ? warColor(e) : lensColor(e);
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
      ${d.conflicts && d.conflicts.length ? sec('Armed conflicts', `<ul class="war-rows">${d.conflicts.map((c) => `<li><button type="button" class="war-row" data-conflict="${c.id}"><span class="swatch" style="background:${WAR_FILL[{ high: 3, medium: 2, low: 1 }[c.intensity]]}"></span><span class="war-name">${esc(c.name)}<small>${esc(INTENSITY_LABEL[c.intensity])}</small></span></button></li>`).join('')}</ul>`) : ''}
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


  /* ---------- conflict mode ---------- */
  const INTENSITY_LABEL = { high: 'High intensity', medium: 'Medium intensity', low: 'Low intensity' };
  const STATUS_LABEL = { active: 'active', 'fragile-ceasefire': 'fragile ceasefire', frozen: 'frozen' };
  const TYPE_LABEL = {
    interstate: 'Interstate war', 'civil-war': 'Civil war', insurgency: 'Insurgency', intercommunal: 'Intercommunal violence',
    criminal: 'Criminal war', 'border-clash': 'Border standoff', 'air-missile-campaign': 'Air and missile campaign',
  };
  const KIND_LABEL = {
    air: 'Air base', naval: 'Naval base', army: 'Army base', joint: 'Joint base', missile: 'Missile site', nuclear: 'Nuclear site',
    'space-intel': 'Space and intelligence site', logistics: 'Logistics hub', chokepoint: 'Chokepoint', 'contested-feature': 'Contested feature',
  };
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
  }

  function dateRange(a, b) {
    if (!b || b === a) return fmtDate(a);
    if (/ongoing/i.test(b)) return `${fmtDate(a)} to now`;
    return `${fmtDate(a)} to ${fmtDate(b)}`;
  }

  function circleFeature(z, c, order) {
    const R = 6371, d = z.r / R, p1 = (z.lat * Math.PI) / 180, l1 = (z.lng * Math.PI) / 180;
    const ring = [];
    for (let i = 0; i <= 48; i += 1) {
      const t = (2 * Math.PI * i) / 48;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
      const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      ring.push([((((l2 * 180) / Math.PI) + 540) % 360) - 180, (p2 * 180) / Math.PI]);
    }
    return {
      type: 'Feature',
      properties: { zone: true, conflict: c.id, intensity: c.intensity, name: z.name, order },
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
  }

  function buildZones() {
    zoneFeatures = [];
    let order = 0;
    for (const c of mil.conflicts) for (const z of c.zones) zoneFeatures.push(circleFeature(z, c, (order += 1) % 12));
  }

  function currentFeatures() {
    return state.mode === 'conflict' && state.layers.zones ? features.concat(zoneFeatures) : features;
  }

  function refreshLayers() {
    if (!world) return;
    world.polygonsData(currentFeatures());
    world.htmlElementsData(htmlData());
    const lines = [];
    if (state.mode === 'conflict' && state.layers.lines) {
      for (const c of mil.conflicts) for (const ln of c.lines) lines.push({ ...ln, conflict: c.id });
    }
    world.pathsData(lines);
    const rings = [];
    if (state.mode === 'conflict' && state.layers.zones && !reduceMotion) {
      for (const c of mil.conflicts) {
        if (c.intensity !== 'high' || c.status !== 'active') continue;
        for (const z of c.zones.slice(0, 4)) rings.push({ lat: z.lat, lng: z.lng, maxR: Math.min(6, (z.r / 111) * 1.4), speed: Math.max(0.4, (z.r / 111) * 0.9) });
      }
    }
    world.ringsData(rings);
    refreshPolygons();
  }

  function setMode(mode, { keepPanel = false } = {}) {
    if (mode === state.mode) return;
    state.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll('.mode-switch button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
    $('#politics-controls').hidden = mode !== 'politics';
    $('#war-controls').hidden = mode !== 'conflict';
    if (mode === 'conflict') {
      renderWarLegend();
      if (mobileMQ.matches) $('#war-controls details').open = false;
    }
    refreshLayers();
    refreshBrowseDots();
    if (!keepPanel && !state.selected && !state.focus) showIntro();
    try { localStorage.setItem('wpm-mode', mode); } catch (_) { /* storage unavailable */ }
  }

  function showIntro() {
    $('#profile').hidden = true;
    $('#intro').hidden = state.mode !== 'politics';
    $('#war-intro').hidden = state.mode !== 'conflict';
  }

  function renderWarLegend() {
    const n = { high: 0, medium: 0, low: 0 };
    for (const c of mil.conflicts) n[c.intensity] += 1;
    const majors = mil.battles.filter((b) => b.tier === 'major').length;
    $('#war-legend').innerHTML = `
      <li><span class="swatch zone-swatch" style="background:${WAR_TINT[3]};--z:${ZONE_FILL.high}"></span>High-intensity war <span class="n">${n.high}</span></li>
      <li><span class="swatch zone-swatch" style="background:${WAR_TINT[2]};--z:${ZONE_FILL.medium}"></span>Medium intensity <span class="n">${n.medium}</span></li>
      <li><span class="swatch zone-swatch" style="background:${WAR_TINT[1]};--z:${ZONE_FILL.low}"></span>Low intensity or frozen <span class="n">${n.low}</span></li>
      <li><span class="legend-line"></span>Front or control line</li>
      <li><span class="mk-demo mk-battle major">${SWORDS}</span>Major battle <span class="n">${majors}</span></li>
      <li><span class="mk-demo mk-battle mid">${SWORDS}</span>Mid-size engagement <span class="n">${mil.battles.length - majors}</span></li>
      <li><span class="mk-demo mk-base"></span>Military base <span class="n">${mil.bases.filter((b) => !/chokepoint|contested/.test(b.kind)).length}</span></li>
      <li><span class="mk-demo mk-base choke">${DIAMOND}</span>Chokepoint or contested spot <span class="n">${mil.bases.filter((b) => /chokepoint|contested/.test(b.kind)).length}</span></li>`;
  }

  function initWarControls() {
    document.querySelectorAll('#war-controls input[data-layer]').forEach((box) => {
      box.checked = state.layers[box.dataset.layer];
      box.addEventListener('change', () => { state.layers[box.dataset.layer] = box.checked; refreshLayers(); });
    });
    const major = $('#major-only');
    major.checked = state.majorOnly;
    major.addEventListener('change', () => { state.majorOnly = major.checked; refreshLayers(); });
  }

  const flagsFor = (isoList) => isoList.map((iso) => byId.get(iso)).filter(Boolean)
    .map((e) => `<button type="button" class="flag-chip" data-id="${e.id}" title="${esc(e.name)}">${esc(e.flag)}<span>${esc(e.name)}</span></button>`).join('');

  function renderWarIntro() {
    const c = mil.conflicts;
    const active = c.filter((x) => x.status === 'active').length;
    $('#war-count').textContent = c.length
      ? `${c.length} armed conflicts and flashpoints, ${active} of them active. ${mil.battles.length} battles and strikes from the last 12 months. ${mil.bases.length} bases and chokepoints.`
      : 'Conflict data is loading or not yet published.';
    const groups = [['high', 'High-intensity wars'], ['medium', 'Medium intensity'], ['low', 'Low intensity, frozen or standoffs']];
    $('#war-list').innerHTML = groups.map(([key, title]) => {
      const list = c.filter((x) => x.intensity === key);
      if (!list.length) return '';
      return `<h3 class="war-group">${title}</h3><ul class="war-rows">${list.map((x) => `
        <li><button type="button" class="war-row" data-conflict="${x.id}">
          <span class="swatch" style="background:${WAR_FILL[{ high: 3, medium: 2, low: 1 }[x.intensity]]}"></span>
          <span class="war-name">${esc(x.name)}<small>${esc(TYPE_LABEL[x.type] || x.type)}, ${esc(STATUS_LABEL[x.status])}${x.battles ? `. ${x.battles} battle${x.battles === 1 ? '' : 's'}` : ''}</small></span>
          <span class="war-flags">${x.countries.slice(0, 4).map((iso) => esc((byId.get(iso) || {}).flag || '')).join('')}</span>
        </button></li>`).join('')}</ul>`;
    }).join('');
    const recent = mil.battles.slice(0, 8);
    $('#war-recent').innerHTML = recent.map((b) => `
      <li><button type="button" data-battle="${b.id}"><span class="lp-year lp-date">${esc(fmtDate(b.start).replace(/ \d{4}$/, ''))}</span><span class="lp-who"><b>${esc(b.name)}</b><span>${esc(b.place)}</span></span></button></li>`).join('');
    renderNewsList($('#war-news'), news.items.filter((n) => n.category === 'military').slice(0, 5));
  }

  function renderNewsList(el, items) {
    if (!el) return;
    el.innerHTML = items.length ? items.map((n) => `
      <li><span class="news-date">${esc(fmtDate(n.date).replace(/ \d{4}$/, ''))}</span><a href="news.html#${esc(n.id)}">${esc(n.headline)}</a></li>`).join('')
      : '<li class="news-empty">No news yet. The daily update fills this in.</li>';
  }

  async function loadConflict(id) {
    if (state.conflictDetails.has(id)) return state.conflictDetails.get(id);
    const res = await fetch(`data/conflicts/${id}.json`);
    if (!res.ok) throw new Error(`Couldn't load ${id}`);
    const d = await res.json();
    state.conflictDetails.set(id, d);
    return d;
  }

  function showPanel(html) {
    $('#intro').hidden = true;
    $('#war-intro').hidden = true;
    $('#profile').hidden = false;
    $('#profile').innerHTML = html;
    $('#profile').querySelectorAll('a[href^="http"]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    const close = $('#close-btn');
    if (close) close.addEventListener('click', closeProfile);
    $('#sheet-scroll').scrollTop = 0;
    setSheet(mobileMQ.matches ? (state.sheet === 'full' ? 'full' : 'open') : 'open');
    const heading = $('#profile-name');
    if (heading && !mobileMQ.matches) heading.focus({ preventScroll: true });
  }

  function focusMil(type, id, title) {
    state.selected = null;
    state.focus = { type, id };
    if (state.mode !== 'conflict') setMode('conflict', { keepPanel: true });
    if (world) world.controls().autoRotate = false;
    refreshPolygons();
    const hash = `#${type[0]}/${id}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    document.title = `${title}, World Politics Matrix`;
  }

  function flyToPoint(lat, lng, alt) {
    if (!world) return;
    world.pointOfView({ lat, lng, altitude: alt + (mobileMQ.matches ? 0.5 : 0) }, reduceMotion ? 0 : 1100);
  }

  function flyToConflict(c) {
    const pts = c.zones.map((z) => [z.lat, z.lng]).concat(...c.lines.map((l) => l.points));
    if (!pts.length) {
      const e = byId.get(c.countries[0]);
      if (e) flyTo(e);
      return;
    }
    const lat = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const lng = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const spread = Math.max(...pts.map((p) => Math.hypot(p[0] - lat, (p[1] - lng) * Math.cos((lat * Math.PI) / 180))), 2);
    flyToPoint(lat, lng, Math.min(2.6, Math.max(0.9, 0.6 + spread / 9)));
  }

  const panelTop = (title, meta, flag = '') => `
    <div class="profile-top">
      <div>
        ${flag ? `<span class="profile-flag" aria-hidden="true">${flag}</span>` : ''}
        <h2 class="profile-name war-name-h" id="profile-name" tabindex="-1">${esc(title)}</h2>
        <p class="profile-where">${meta}</p>
      </div>
      <button class="close" type="button" id="close-btn" aria-label="Close">${CLOSE_ICON}</button>
    </div>`;

  const sourceList = (list) => (list && list.length
    ? `<ol class="sources">${list.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('')}</ol>` : '');

  const section = (title, inner) => (inner ? `<section><h2>${title}</h2>${inner}</section>` : '');
  const pList = (list) => (list && list.length ? list.map((p) => `<p>${p}</p>`).join('') : '');

  async function openConflict(id, { fly = true } = {}) {
    const light = conflictById.get(id);
    if (!light) return;
    focusMil('conflict', id, light.name);
    if (fly) flyToConflict(light);
    showPanel(`<p class="lead-in">Loading ${esc(light.name)}</p>`);
    let d;
    try { d = await loadConflict(id); } catch (err) {
      showPanel(`${panelTop(light.name, '')}<p>Couldn't load this conflict. Check your connection and try again.</p>`);
      return;
    }
    if (!state.focus || state.focus.id !== id) return;
    const chips = [TYPE_LABEL[d.type] || d.type, INTENSITY_LABEL[d.intensity], STATUS_LABEL[d.status], d.started ? `since ${fmtDate(d.started)}` : '']
      .filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('');
    const sides = d.sides.map((sd) => `
      <div class="side">
        <h3>${esc(sd.name)}</h3>
        ${sd.members.length ? `<p><b>Forces.</b> ${esc(sd.members.join(', '))}</p>` : ''}
        ${sd.leaders.length ? `<p><b>Leaders.</b> ${esc(sd.leaders.join('; '))}</p>` : ''}
        ${sd.backers.length ? `<p><b>Backers.</b> ${esc(sd.backers.join('; '))}</p>` : ''}
        ${sd.strength ? `<p><b>Strength.</b> ${sd.strength}</p>` : ''}
      </div>`).join('');
    const battles = d.battles.length ? `<ul class="battle-list">${d.battles.map((b) => `
      <li><button type="button" data-battle="${b.id}"><span class="bl-date">${esc(fmtDate(b.start))}</span><span class="bl-name">${esc(b.name)}<small>${esc(b.place)}</small></span><span class="tier ${b.tier}">${b.tier === 'major' ? 'Major' : 'Mid'}</span></button></li>`).join('')}</ul>` : '';
    const timeline = d.timeline.length ? `<ol class="timeline">${d.timeline.map((t) => `<li><span>${esc(fmtDate(t.date))}</span><p>${t.event}</p></li>`).join('')}</ol>` : '';
    const tech = d.technical.length ? `<ul class="tech">${d.technical.map((t) => `<li>${t}</li>`).join('')}</ul>` : '';
    const toll = [d.casualties ? `<p><b>Casualties.</b> ${d.casualties}</p>` : '', d.displaced ? `<p><b>Displaced.</b> ${d.displaced}</p>` : ''].join('');
    const zones = d.zones.length ? `<ul class="zones">${d.zones.map((z) => `<li><b>${esc(z.name)}.</b> ${z.note}</li>`).join('')}</ul>` : '';
    showPanel(`
      ${panelTop(d.name, `${d.countries.map((iso) => esc((byId.get(iso) || {}).name || iso)).join(', ')}`)}
      <ul class="tags war-chips">${chips}</ul>
      <p class="snapshot">${d.summary}</p>
      <div class="flag-row">${flagsFor(d.countries)}</div>
      ${section('Where it stands', pList(d.situation))}
      ${section('Who is fighting', sides)}
      ${section('The last 12 months', pList(d.year))}
      ${section('Battles and strikes', battles)}
      ${section('Technical picture', tech)}
      ${section('The human toll', toll)}
      ${section('Where the fighting is', zones)}
      ${section('Timeline', timeline)}
      ${section('Background', pList(d.background))}
      ${section('What to watch', d.outlook ? `<p>${d.outlook}</p>` : '')}
      ${section('Sources', sourceList(d.sources))}`);
  }

  async function openBattle(id) {
    const light = battleById.get(id);
    if (!light) return;
    focusMil('battle', id, light.name);
    flyToPoint(light.lat, light.lng, 0.7);
    const c = conflictById.get(light.conflict);
    let full = light;
    try {
      const d = await loadConflict(light.conflict);
      full = d.battles.find((b) => b.id === id) || light;
    } catch (_) { /* fall back to light data */ }
    if (!state.focus || state.focus.id !== id) return;
    const facts = [
      ['When', esc(dateRange(full.start, full.end))],
      ['Where', esc(full.place)],
      ['Result', full.outcome],
    ].filter(([, v]) => v).map(([k, v]) => `<div class="wide"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    showPanel(`
      ${panelTop(full.name, `${full.tier === 'major' ? 'Major battle' : 'Mid-size engagement'}${c ? ` in <button type="button" class="link" data-conflict="${c.id}">${esc(c.name)}</button>` : ''}`)}
      <dl class="facts">${facts}</dl>
      ${full.sides && full.sides.length ? section('Who fought', `<ul class="zones">${full.sides.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`) : ''}
      ${section('Why it matters', full.significance ? `<p>${full.significance}</p>` : '')}
      ${section('Forces and equipment', full.forces ? `<p>${full.forces}</p>` : '')}
      ${section('Losses', full.losses ? `<p>${full.losses}</p>` : '')}
      ${section('Sources', sourceList(full.sources))}
      ${c ? `<p class="sov-link"><button class="btn" type="button" data-conflict="${c.id}">Open ${esc(c.name)}</button></p>` : ''}`);
  }

  function openBase(id) {
    const b = baseById.get(id);
    if (!b) return;
    focusMil('base', id, b.name);
    flyToPoint(b.lat, b.lng, 0.75);
    const host = b.country && byId.get(b.country);
    const facts = [
      ['Type', esc(KIND_LABEL[b.kind] || b.kind)],
      ['Host', host ? `<button type="button" class="link" data-id="${host.id}">${esc(host.flag)} ${esc(host.name)}</button>` : ''],
      ['Operated by', esc(b.operators.join(', '))],
      ['Coordinates', `${b.lat.toFixed(3)}, ${b.lng.toFixed(3)}`],
    ].filter(([, v]) => v).map(([k, v]) => `<div class="wide"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    showPanel(`
      ${panelTop(b.name, `${esc(b.tier === 'critical' ? 'Critical site' : b.tier === 'important' ? 'Important site' : 'Notable site')}`)}
      <dl class="facts">${facts}</dl>
      ${section('Why it matters', b.why ? `<p>${b.why}</p>` : '')}
      ${section('What is there', b.assets ? `<p>${b.assets}</p>` : '')}
      ${section('In 2026', b.year ? `<p>${b.year}</p>` : '')}
      ${section('Sources', sourceList(b.sources))}`);
  }

  function initPanelLinks() {
    // Delegated clicks for links rendered inside panels and intros
    $('#sheet-scroll').addEventListener('click', (ev) => {
      const conflict = ev.target.closest('[data-conflict]');
      if (conflict) { ev.preventDefault(); openConflict(conflict.dataset.conflict); return; }
      const battle = ev.target.closest('[data-battle]');
      if (battle) { ev.preventDefault(); openBattle(battle.dataset.battle); return; }
      const chip = ev.target.closest('.flag-chip[data-id], #profile .link[data-id]');
      if (chip) { ev.preventDefault(); setMode('politics', { keepPanel: true }); select(chip.dataset.id); }
    });
  }

  function routeFromHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h === 'conflicts') { setMode('conflict'); return true; }
    const m = h.match(/^([cbm])\/(.+)$/);
    if (m) {
      if (m[1] === 'c' && conflictById.has(m[2])) { if (!state.focus || state.focus.id !== m[2]) openConflict(m[2]); return true; }
      if (m[1] === 'b' && battleById.has(m[2])) { if (!state.focus || state.focus.id !== m[2]) openBattle(m[2]); return true; }
      if (m[1] === 'm' && baseById.has(m[2])) { if (!state.focus || state.focus.id !== m[2]) openBase(m[2]); return true; }
      return false;
    }
    const id = h.toUpperCase();
    if (byId.has(id) && id !== state.selected) { select(id); return true; }
    return false;
  }

  /* ---------- selection ---------- */
  async function select(id, { fly = true } = {}) {
    const e = byId.get(id);
    if (!e) return;
    state.selected = id;
    state.focus = null;
    if (world) world.controls().autoRotate = false;
    refreshPolygons();
    if (fly) flyTo(e);
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    document.title = `${e.name}, World Politics Matrix`;

    $('#intro').hidden = true;
    $('#war-intro').hidden = true;
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
    state.focus = null;
    refreshPolygons();
    showIntro();
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
    const [idx, topo, m, n] = await Promise.all([
      fetch('data/index.json').then((r) => r.json()),
      fetch('data/world.topo.json').then((r) => r.json()),
      fetch('data/military.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('data/news.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    index = idx;
    if (m) mil = m;
    if (n) news = n;
    conflictById = new Map(mil.conflicts.map((c) => [c.id, c]));
    battleById = new Map(mil.battles.map((b) => [b.id, b]));
    baseById = new Map(mil.bases.map((b) => [b.id, b]));
    byId = new Map(index.entities.map((e) => [e.id, e]));
    lensColor = buildLensColor();
    features = topojson.feature(topo, topo.objects.countries).features;
    buildZones();

    try { const saved = localStorage.getItem('wpm-lens'); if (saved && LENSES[saved]) state.lens = saved; } catch (_) { /* storage unavailable */ }

    let savedMode = 'politics';
    try { if (localStorage.getItem('wpm-mode') === 'conflict') savedMode = 'conflict'; } catch (_) { /* storage unavailable */ }
    if (/^#([cbm]\/|conflicts$)/.test(location.hash)) savedMode = 'conflict';

    renderIntro();
    renderWarIntro();
    renderNewsList($('#latest-news'), news.items.slice(0, 5));
    initSearch();
    initSheet();
    initWarControls();
    initPanelLinks();
    initGlobe($('#globe'));
    setLens(state.lens);
    document.querySelectorAll('.mode-switch button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    document.body.dataset.mode = 'politics';
    if (savedMode === 'conflict') setMode('conflict');

    document.querySelectorAll('.lens-switch button').forEach((b) => b.addEventListener('click', () => setLens(b.dataset.lens)));
    $('#random-war').addEventListener('click', () => {
      const pool = mil.conflicts.filter((c) => c.status === 'active');
      if (pool.length) openConflict(pool[Math.floor(Math.random() * pool.length)].id);
    });
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
      else if (ev.key === 'Escape' && !typing && (state.selected || state.focus)) closeProfile();
    });
    window.addEventListener('hashchange', routeFromHash);
    routeFromHash();
  }

  boot().catch((err) => {
    console.error(err);
    const l = $('#loading');
    l.hidden = false;
    l.textContent = 'The map data failed to load. Reload the page to try again.';
  });
})();
