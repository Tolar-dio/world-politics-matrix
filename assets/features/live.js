/* Live Earth: earthquakes (USGS), disasters (GDACS) and volcanoes and storms (NASA EONET), live in the browser. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  const $ = (s, r = document) => r.querySelector(s);

  const FEEDS = {
    quakes: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
    gdacs: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP',
    eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&category=volcanoes,severeStorms',
  };
  const KINDS = {
    quake: { label: 'Earthquake', rgb: '112,78,168', glyph: '<circle cx="8" cy="8" r="2.4" fill="currentColor"/><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.4"/>' },
    storm: { label: 'Tropical cyclone or storm', rgb: '44,118,170', glyph: '<path d="M8 3.2a4.8 4.8 0 1 0 4.8 4.8M8 12.8a4.8 4.8 0 1 0-4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>' },
    flood: { label: 'Flood', rgb: '32,138,150', glyph: '<path d="M2 7c2-2 4 2 6 0s4 2 6 0M2 11c2-2 4 2 6 0s4 2 6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
    volcano: { label: 'Volcano', rgb: '176,46,36', glyph: '<path d="M2 13l4.2-7h3.6L14 13z" fill="currentColor"/><path d="M7 4l-.8-2M9 4l.8-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
    fire: { label: 'Wildfire', rgb: '222,104,36', glyph: '<path d="M8 2c1 3 4 4 4 7.5A4 4 0 0 1 4 9.5C4 7.6 5.2 6.6 6 5.5c.3 1.3 1 2 1.6 2.2C7.4 5.6 7.4 3.8 8 2z" fill="currentColor"/>' },
    drought: { label: 'Drought', rgb: '170,130,50', glyph: '<circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
  };
  const GDACS_KIND = { TC: 'storm', FL: 'flood', VO: 'volcano', WF: 'fire', DR: 'drought' };
  const ALERT = { Green: 'Green alert (limited impact expected)', Orange: 'Orange alert (moderate impact)', Red: 'Red alert (severe impact)' };

  let on = false, events = [], timer = null, fetchedAt = null, failed = [];

  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return `${Math.max(1, m)} min ago`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  };

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function load() {
    failed = [];
    const out = [];
    const [q, g, e] = await Promise.allSettled([getJSON(FEEDS.quakes), getJSON(FEEDS.gdacs), getJSON(FEEDS.eonet)]);
    if (q.status === 'fulfilled') {
      for (const f of q.value.features) {
        const p = f.properties, [lng, lat, depth] = f.geometry.coordinates;
        out.push({ id: `usgs-${f.id}`, kind: 'quake', lat, lng, t: p.time, size: p.mag,
          title: `Magnitude ${p.mag.toFixed(1)} earthquake`, place: p.place, detail: `${Math.round(depth)} km deep${p.tsunami ? '. Tsunami flag raised' : ''}${p.alert ? `. USGS ${p.alert} alert for impact` : ''}`,
          url: p.url, source: 'USGS', severe: p.mag >= 6.5 || !!p.alert });
      }
    } else failed.push('USGS earthquakes');
    if (g.status === 'fulfilled') {
      for (const f of g.value.features) {
        const p = f.properties, kind = GDACS_KIND[p.eventtype];
        if (!kind) continue; // earthquakes come from USGS
        if (kind === 'fire' && p.alertlevel === 'Green') continue; // dozens of small fires a day; keep the ones GDACS flags
        const [lng, lat] = f.geometry.coordinates;
        out.push({ id: `gdacs-${p.eventtype}-${p.eventid}`, kind, lat, lng, t: Date.parse(p.fromdate + 'Z'), size: p.alertlevel === 'Red' ? 3 : p.alertlevel === 'Orange' ? 2 : 1,
          title: p.name || KINDS[kind].label, place: p.country || '', detail: [p.severitydata && p.severitydata.severitytext, ALERT[p.alertlevel]].filter(Boolean).join('. '),
          url: p.url && p.url.report, source: 'GDACS', severe: p.alertlevel !== 'Green' });
      }
    } else failed.push('GDACS disasters');
    if (e.status === 'fulfilled') {
      for (const ev of e.value.events) {
        const geo = ev.geometry[ev.geometry.length - 1];
        if (!geo || geo.type !== 'Point') continue;
        const kind = ev.categories[0].id === 'volcanoes' ? 'volcano' : 'storm';
        const [lng, lat] = geo.coordinates;
        if (out.some((x) => x.kind === kind && Math.abs(x.lat - lat) < 1 && Math.abs(x.lng - lng) < 1)) continue;
        out.push({ id: `eonet-${ev.id}`, kind, lat, lng, t: Date.parse(geo.date), size: 1,
          title: ev.title, place: '', detail: geo.magnitudeValue ? `${geo.magnitudeValue} ${geo.magnitudeUnit}` : '',
          url: (ev.sources[0] || {}).url || ev.link, source: 'NASA EONET', severe: false });
      }
    } else failed.push('NASA EONET');
    events = out.sort((a, b) => b.t - a.t);
    fetchedAt = Date.now();
  }

  function tipHtml(ev) {
    const k = KINDS[ev.kind];
    return `<div class="tip-name">${esc(ev.title)}</div><div class="tip-key"><span class="swatch" style="background:rgb(${k.rgb})"></span>${esc(k.label)}, ${esc(ago(ev.t))}</div>${ev.place ? `<div class="tip-key">${esc(ev.place)}</div>` : ''}${ev.detail ? `<div class="tip-snap">${esc(ev.detail)}</div>` : ''}`;
  }

  function render(ev) {
    const k = KINDS[ev.kind];
    const b = document.createElement('button');
    b.type = 'button';
    const big = ev.kind === 'quake' ? Math.max(0, Math.min(1, (ev.size - 4.5) / 2.5)) : (ev.size - 1) / 2;
    b.className = `live-mk${ev.severe ? ' severe' : ''}`;
    b.style.setProperty('--c', `rgb(${k.rgb})`);
    b.style.setProperty('--s', `${14 + big * 10}px`);
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${k.glyph}</svg>`;
    b.setAttribute('aria-label', `${ev.title}${ev.place ? `, ${ev.place}` : ''}, ${ago(ev.t)}`);
    ['pointerdown', 'pointerup', 'pointermove'].forEach((t) => b.addEventListener(t, (x) => x.stopPropagation()));
    b.addEventListener('mouseenter', () => { if (!W.mobile) W.showTip(tipHtml(ev)); });
    b.addEventListener('mouseleave', () => W.hideTip());
    b.addEventListener('click', (x) => { x.stopPropagation(); openPanel(ev.id); });
    return b;
  }

  function draw() {
    if (!on) { W.setHtml('live', []); W.setRings('live', []); return; }
    W.setHtml('live', events.map((ev) => ({ ...ev, render })));
    const recent = Date.now() - 48 * 3600e3;
    W.setRings('live', W.reduceMotion ? [] : events.filter((ev) => ev.severe || (ev.kind === 'quake' && ev.t > recent)).slice(0, 40)
      .map((ev) => ({ lat: ev.lat, lng: ev.lng, rgb: KINDS[ev.kind].rgb, maxR: ev.kind === 'quake' ? 1 + Math.max(0, ev.size - 4.5) * 1.6 : 2 + ev.size, speed: 1.2 })));
  }

  function openPanel(focusId) {
    const ev = focusId && events.find((x) => x.id === focusId);
    if (ev) W.flyToPoint(ev.lat, ev.lng, 0.9, { closerOnly: true });
    const groups = ['storm', 'flood', 'volcano', 'fire', 'drought', 'quake'].map((k) => [k, events.filter((x) => x.kind === k)]).filter(([, l]) => l.length);
    const row = (x) => `<li${x.id === focusId ? ' class="on"' : ''}><button type="button" data-live="${esc(x.id)}">
        <span class="live-ico" style="--c:rgb(${KINDS[x.kind].rgb})"><svg viewBox="0 0 16 16" aria-hidden="true">${KINDS[x.kind].glyph}</svg></span>
        <span class="live-txt"><b>${esc(x.title)}</b><small>${esc([x.place, ago(x.t)].filter(Boolean).join('. '))}</small></span></button>
        ${x.url ? `<a class="live-src" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.source)}</a>` : ''}</li>`;
    const focus = ev ? `<div class="live-focus">${tipHtml(ev)}${ev.url ? `<p class="more-link"><a href="${esc(ev.url)}" target="_blank" rel="noopener">Full report from ${esc(ev.source)}</a></p>` : ''}</div>` : '';
    W.openPanel({ hash: '#live', title: 'Live Earth', html: `
      ${W.panelTop('Live Earth', `${events.length} events on the globe right now. Updated ${fetchedAt ? esc(ago(fetchedAt)) : 'just now'}.`)}
      ${focus}
      ${failed.length ? `<p class="live-warn">Couldn't reach ${esc(failed.join(', '))}. The rest is shown.</p>` : ''}
      ${groups.map(([k, list]) => `<h3 class="num-h">${esc(KINDS[k].label)}s <span>${list.length}</span></h3><ul class="live-list">${list.slice(0, 40).map(row).join('')}</ul>`).join('')}
      <p class="intro-foot">Earthquakes of magnitude 4.5 and up in the past week from the <a href="https://earthquake.usgs.gov/earthquakes/map/" target="_blank" rel="noopener">USGS</a>. Cyclones, floods, droughts, volcanoes and major wildfires from <a href="https://www.gdacs.org" target="_blank" rel="noopener">GDACS</a>, the UN and European Commission's disaster alert system, and <a href="https://eonet.gsfc.nasa.gov" target="_blank" rel="noopener">NASA EONET</a>. Pulled live by your browser, every ten minutes while Live Earth is on.</p>` });
  }

  async function setOn(next) {
    on = next;
    const btn = $('#live-btn');
    if (btn) btn.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('wpm-live', on ? '1' : '0'); } catch (_) { /* storage unavailable */ }
    clearInterval(timer);
    if (!on) { draw(); return; }
    btn && btn.classList.add('busy');
    try { await load(); } catch (_) { /* partial failures are recorded in `failed` */ }
    btn && btn.classList.remove('busy');
    draw();
    timer = setInterval(async () => { await load(); draw(); }, 10 * 60e3);
  }

  W.ext.routes.push((h) => {
    if (h !== 'live') return false;
    (on ? Promise.resolve() : setOn(true)).then(() => openPanel());
    return true;
  });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-live]');
    if (b) { ev.preventDefault(); openPanel(b.dataset.live); }
  });

  W.on('ready', () => {
    const tools = $('#globe-tools');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'live-btn';
    btn.className = 'tool';
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${KINDS.quake.glyph}</svg><span>Live Earth</span>`;
    btn.title = 'Show earthquakes, storms, floods, fires and volcanoes happening now';
    btn.addEventListener('click', () => { setOn(!on).then(() => { if (on) openPanel(); }); });
    tools.appendChild(btn);
    let saved = '0';
    try { saved = localStorage.getItem('wpm-live') || '0'; } catch (_) { /* storage unavailable */ }
    if (saved === '1') setOn(true);
  });
})();
