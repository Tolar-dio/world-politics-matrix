/* Storylines: the big threads that tie countries together, drawn as arcs across the globe. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  const $ = (s, r = document) => r.querySelector(s);

  const STATUS = {
    escalating: ['Escalating', '#B9473C'], grinding: ['Grinding on', '#B48232'], talks: ['In talks', '#3E6A86'],
    shifting: ['Shifting', '#7F6AAA'], cooling: ['Cooling', '#4A8E7F'],
  };
  let threads = [], byThread = new Map(), open = null;
  const newsById = () => new Map(W.news.items.map((n) => [n.id, n]));

  W.ext.colorOverrides.push((e, base) => {
    if (!open || W.state.mode !== 'politics' || e.kind !== 'country') return null;
    return open.countries.includes(e.id) ? null : W.mix(base, W.isDark() ? '#172027' : '#F6F7F7', 0.62);
  });

  function drawArcs(t) {
    if (!t) { W.setArcs('thread', []); return; }
    const arcs = t.links.map((l) => {
      const a = W.byId.get(l.from), b = W.byId.get(l.to);
      if (!a || !b) return null;
      return { startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng, label: `${a.name} and ${b.name}: ${l.label}`,
        color: W.isDark() ? ['rgba(232,199,106,0.95)', 'rgba(255,240,200,0.95)'] : ['rgba(140,100,20,0.95)', 'rgba(200,150,46,0.95)'],
        stroke: 0.7, dash: 0.42, gap: 0.12, animate: 2800, scale: 0.35 };
    }).filter(Boolean);
    W.setArcs('thread', arcs);
  }

  function fly(t) {
    const pts = t.countries.map((c) => W.byId.get(c)).filter(Boolean);
    if (!pts.length) return;
    // Average on the unit sphere so threads spanning the date line still centre sensibly.
    let x = 0, y = 0, z = 0;
    for (const p of pts) {
      const la = (p.lat * Math.PI) / 180, lo = (p.lng * Math.PI) / 180;
      x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
    }
    const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lng = (Math.atan2(y, x) * 180) / Math.PI;
    const spread = Math.max(...pts.map((p) => Math.hypot(p.lat - lat, ((((p.lng - lng) + 540) % 360) - 180) * Math.cos((lat * Math.PI) / 180))));
    W.flyToPoint(lat, lng, Math.min(2.8, Math.max(0.9, spread * 0.05)));
  }

  function card(t) {
    const [label, color] = STATUS[t.status];
    return `<li><button type="button" class="thread-card" data-thread="${t.id}">
      <span class="thread-status" style="--c:${color}">${esc(label)}</span>
      <b>${esc(t.title)}</b><span class="thread-dek">${esc(t.dek)}</span>
      <span class="thread-meta">${t.countries.slice(0, 7).map((c) => esc((W.byId.get(c) || {}).flag || '')).join('')}${t.count7 ? `<span>${t.count7} stor${t.count7 === 1 ? 'y' : 'ies'} this week</span>` : ''}</span>
    </button></li>`;
  }

  function openThread(id) {
    const t = byThread.get(id);
    if (!t) return;
    open = t;
    if (W.state.mode !== 'politics') W.setMode('politics', { keepPanel: true });
    drawArcs(t);
    fly(t);
    const nb = newsById();
    const [label, color] = STATUS[t.status];
    const key = t.key.map((k) => {
      const link = k.conflict ? ` <button type="button" class="link" data-conflict="${k.conflict}">Open the conflict</button>`
        : k.news ? ` <a href="news.html#${esc(k.news)}">Read the story</a>` : (k.sources || []).map((s) => ` <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label.split(':')[0])}</a>`).join('');
      return `<li><span>${esc(k.pretty)}</span><p>${k.text}${link}</p></li>`;
    }).join('');
    const news = t.news.map((x) => nb.get(x)).filter(Boolean).slice(0, 15);
    const links = t.links.map((l) => `<li><span class="link-pair">${esc((W.byId.get(l.from) || {}).flag || '')} ${esc((W.byId.get(l.from) || {}).name || l.from)} <span aria-hidden="true">and</span> ${esc((W.byId.get(l.to) || {}).flag || '')} ${esc((W.byId.get(l.to) || {}).name || l.to)}</span><span class="link-why">${esc(l.label)}</span></li>`).join('');
    W.openPanel({ hash: `#t/${id}`, title: t.title, html: `
      ${W.panelTop(t.title, `<span class="thread-status" style="--c:${color}">${esc(label)}</span>`)}
      <p class="snapshot">${esc(t.dek)}</p>
      <div class="flag-row">${W.flagsFor(t.countries)}</div>
      ${W.section('Why it matters', `<p>${t.why}</p>`)}
      ${W.section('How the pieces connect', `<ul class="thread-links">${links}</ul><p class="num-help">The gold arcs on the globe trace these links. Hover over one for its label.</p>`)}
      ${W.section('Key moments', key ? `<ol class="timeline thread-key">${key}</ol>` : '')}
      ${W.section('Latest', news.length ? `<ul class="news-mini">${news.map((n) => `<li><span class="news-date">${esc(W.fmtDate(n.date).replace(/ \d{4}$/, ''))}</span><a href="news.html#${esc(n.id)}">${esc(n.headline)}</a></li>`).join('')}</ul>` : '')}
      ${W.section('What to watch', t.watch ? `<p>${t.watch}</p>` : '')}
      ${t.conflicts.length ? W.section('Wars in this storyline', `<ul class="war-rows">${t.conflicts.map((c) => W.conflictById.get(c)).filter(Boolean).map((c) => `<li><button type="button" class="war-row" data-conflict="${c.id}"><span class="swatch" style="background:#B9473C"></span><span class="war-name">${esc(c.name)}</span></button></li>`).join('')}</ul>`) : ''}
      <p class="sov-link"><a href="#threads">All storylines</a></p>` });
    W.refreshPolygons();
  }

  function openAll() {
    open = null;
    drawArcs(null);
    W.openPanel({ hash: '#threads', title: 'Storylines', html: `
      ${W.panelTop('Storylines', 'The big threads that tie countries together')}
      <p class="snapshot">No country's story stands alone. These are the threads running through this year's news, and the links between the places they touch.</p>
      <ul class="thread-cards">${threads.map(card).join('')}</ul>` });
  }

  W.ext.profileSections.push((d) => {
    if (!d.threads || !d.threads.length) return '';
    return `<section><h2>Part of these storylines</h2><ul class="thread-cards compact">${d.threads.map((x) => byThread.get(x.id)).filter(Boolean).map(card).join('')}</ul></section>`;
  });

  W.ext.routes.push((h) => {
    if (h === 'threads') { whenReady(openAll); return true; }
    const m = h.match(/^t\/([a-z0-9-]+)$/);
    if (!m) return false;
    whenReady(() => openThread(m[1]));
    return true;
  });

  let ready = false; const queue = [];
  const whenReady = (fn) => (ready ? fn() : queue.push(fn));

  const clear = () => { if (open) { open = null; drawArcs(null); W.refreshPolygons(); } };
  W.on('close', clear);
  W.on('select', clear);
  W.on('mode', (m) => { if (m === 'conflict') clear(); });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-thread]');
    if (b) { ev.preventDefault(); openThread(b.dataset.thread); }
  });

  W.on('ready', async () => {
    try { threads = (await fetch('data/threads.json').then((r) => r.json())).threads || []; } catch (_) { threads = []; }
    // Busiest first, so the intro leads with what is moving now.
    threads.sort((a, b) => b.count7 - a.count7 || (b.latest || '').localeCompare(a.latest || ''));
    byThread = new Map(threads.map((t) => [t.id, t]));
    ready = true;
    queue.splice(0).forEach((fn) => fn());
    const el = $('#intro-threads');
    if (el && threads.length) el.innerHTML = `<h2 class="intro-h">Storylines</h2><ul class="thread-cards">${threads.slice(0, 4).map(card).join('')}</ul><p class="more-link"><a href="#threads">All ${threads.length} storylines</a></p>`;
    W.rerenderProfile();
  });
})();
