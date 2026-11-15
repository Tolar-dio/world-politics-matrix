/* Connections: who each country is allied with, trades with, buys weapons from, and who sanctions it, drawn as arcs. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  const $ = (s, r = document) => r.querySelector(s);
  const KEY = 'wpm-web';
  const KIND = { military: 'Defence pacts', union: 'Unions', economic: 'Trade and economic blocs', political: 'Political groups' };
  const COLORS = {
    out: () => (W.isDark() ? ['rgba(120,205,185,0.15)', 'rgba(120,205,185,0.95)'] : ['rgba(38,120,104,0.15)', 'rgba(38,120,104,0.95)']),
    in: () => (W.isDark() ? ['rgba(232,190,100,0.15)', 'rgba(232,190,100,0.95)'] : ['rgba(170,110,20,0.15)', 'rgba(170,110,20,0.95)']),
    arms: () => (W.isDark() ? ['rgba(240,120,105,0.15)', 'rgba(240,120,105,0.95)'] : ['rgba(170,55,45,0.15)', 'rgba(170,55,45,0.95)']),
    bloc: () => (W.isDark() ? 'rgba(186,170,230,0.75)' : 'rgba(110,90,170,0.75)'),
  };

  let meta = null, blocs = new Map(), current = null; // current = {id, d}
  let view = 'trade';
  try { view = localStorage.getItem(KEY) || 'trade'; } catch (_) { /* storage unavailable */ }

  const money = (v) => (v >= 1e12 ? `$${(v / 1e12).toFixed(1)} trillion` : v >= 1e9 ? `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)} billion` : `$${Math.round(v / 1e6)} million`);
  const nameOf = (x) => (W.byId.get(x) || {}).name || x;
  const flagOf = (x) => (W.byId.get(x) || {}).flag || '';
  const pctTxt = (p) => (p >= 10 ? Math.round(p) : p.toFixed(1)).toString();

  function arc(from, to, color, label, extra = {}) {
    const a = W.byId.get(from), b = W.byId.get(to);
    if (!a || !b || from === to) return null;
    return { startLat: a.lat, startLng: a.lng, endLat: b.lat, endLng: b.lng, color, label, stroke: 0.5, scale: 0.3, ...extra };
  }

  function draw() {
    if (!current || W.state.mode !== 'politics' || W.state.selected !== current.id) { W.setArcs('web', []); return; }
    const { id, d } = current, c = d.connections || {}, me = nameOf(id);
    let arcs = [];
    if (view === 'trade' && c.trade) {
      const t = c.trade;
      arcs = [
        ...t.to.slice(0, 5).map(([p, v, s]) => arc(id, p, COLORS.out(), `${me} to ${nameOf(p)}: ${money(v)} of exports, ${pctTxt(s)}% of the total (${t.year})`, { stroke: 0.25 + s / 25, dash: 0.3, gap: 0.08, animate: 2600 })),
        ...t.from.slice(0, 5).map(([p, v, s]) => arc(p, id, COLORS.in(), `${nameOf(p)} to ${me}: ${money(v)} of imports, ${pctTxt(s)}% of the total (${t.year})`, { stroke: 0.25 + s / 25, dash: 0.3, gap: 0.08, animate: 2600 })),
      ];
    } else if (view === 'arms') {
      const per = meta ? meta.arms.period.replace('-', ' to ') : '';
      if (c.arms_in) arcs.push(...c.arms_in.from.filter(([p]) => W.byId.has(p)).map(([p, s]) => arc(p, id, COLORS.arms(), `${nameOf(p)} supplied ${pctTxt(s)}% of ${me}'s major arms imports, ${per}`, { stroke: 0.3 + s / 30, dash: 0.25, gap: 0.1, animate: 2200 })));
      if (c.arms_out) arcs.push(...c.arms_out.to.filter(([p]) => W.byId.has(p)).map(([p, s]) => arc(id, p, COLORS.arms(), `${pctTxt(s)}% of ${me}'s major arms exports went to ${nameOf(p)}, ${per}`, { stroke: 0.3 + s / 30, dash: 0.25, gap: 0.1, animate: 2200 })));
    } else if (view.startsWith('bloc:')) {
      const b = blocs.get(view.slice(5));
      if (b) arcs = b.members.filter((m) => m !== id).map((m) => arc(id, m, COLORS.bloc(), `${b.short}: ${me} and ${nameOf(m)}${b.status[m] ? ` (${nameOf(m)} ${b.status[m]})` : ''}`, { stroke: 0.35, scale: 0.25 }));
    }
    W.setArcs('web', arcs.filter(Boolean));
  }

  function setView(v) {
    view = v;
    if (!v.startsWith('bloc:')) { try { localStorage.setItem(KEY, v); } catch (_) { /* storage unavailable */ } }
    draw();
    document.querySelectorAll('[data-web]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.web === v)));
    const note = $('#web-bloc-note');
    if (note) {
      const b = v.startsWith('bloc:') && blocs.get(v.slice(5));
      note.hidden = !b;
      if (b) {
        note.innerHTML = `<b>${esc(b.name)}</b>, ${b.members.length} members. ${esc(b.what)}${b.note ? ` ${esc(b.note)}` : ''} <span class="src">${b.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label.split(':')[0])}</a>`).join(', ')}</span>`;
      }
    }
  }

  function bars(list, cls) {
    return `<ol class="web-bars ${cls}">${list.slice(0, 5).map(([p, v, s]) => `<li><span class="web-who">${esc(flagOf(p))} ${esc(nameOf(p))}</span><span class="web-bar"><i style="width:${Math.min(100, s * 2.2)}%"></i></span><span class="web-n">${pctTxt(s)}%</span></li>`).join('')}</ol>`;
  }

  function sectionHtml(d) {
    const c = d.connections;
    if (!c || !meta) return '';
    const me = esc(d.name);
    const parts = [];
    const has = { trade: !!c.trade, arms: !!(c.arms_in || c.arms_out) };
    const switcher = `<div class="web-switch" role="group" aria-label="Show on the globe">
      <span>On the globe:</span>
      ${has.trade ? `<button type="button" data-web="trade" aria-pressed="${view === 'trade'}"><i class="sw out"></i>Trade</button>` : ''}
      ${has.arms ? `<button type="button" data-web="arms" aria-pressed="${view === 'arms'}"><i class="sw arms"></i>Arms</button>` : ''}
      <button type="button" data-web="off" aria-pressed="${view === 'off'}">Off</button>
    </div>`;

    if (c.blocs && c.blocs.length) {
      const byKind = new Map();
      for (const [bid, status] of c.blocs) {
        const b = blocs.get(bid);
        if (!b) continue;
        if (!byKind.has(b.kind)) byKind.set(b.kind, []);
        byKind.get(b.kind).push([b, status]);
      }
      parts.push(`<h3 class="num-h">Allies and blocs</h3>
        ${['military', 'union', 'economic', 'political'].filter((k) => byKind.has(k)).map((k) => `<div class="web-kind"><span>${KIND[k]}</span><ul class="web-chips">${byKind.get(k).map(([b, st]) => `<li><button type="button" data-web="bloc:${b.id}" aria-pressed="${view === `bloc:${b.id}`}" title="${esc(b.name)}">${esc(b.short)}${st ? `<small>${esc(st)}</small>` : ''}</button></li>`).join('')}</ul></div>`).join('')}
        <p class="web-bloc-note" id="web-bloc-note" hidden></p>
        <p class="num-help">Tap a group to draw its members on the globe. Memberships as of ${esc(meta.blocs_as_of)}.</p>`);
    } else {
      parts.push(`<h3 class="num-h">Allies and blocs</h3><p class="num-help">${me} isn't in any of the alliances or major blocs tracked here.</p>`);
    }

    if (c.trade) {
      const t = c.trade;
      parts.push(`<h3 class="num-h">Trade <span>${t.year}, goods only</span></h3>
        <p class="web-total">Sold ${money(t.exports)} of goods abroad and bought ${money(t.imports)}.${t.exports > t.imports ? ` A surplus of ${money(t.exports - t.imports)}.` : ` A deficit of ${money(t.imports - t.exports)}.`}</p>
        <div class="web-cols"><div><p class="web-h"><i class="sw out"></i>Biggest buyers</p>${bars(t.to, 'out')}</div><div><p class="web-h"><i class="sw in"></i>Biggest suppliers</p>${bars(t.from, 'in')}</div></div>
        ${t.mirror ? `<p class="num-help">${me} doesn't report its trade to the UN, so these figures come from what its partners report buying from and selling to it. Trade with non-reporting neighbours, and smuggling, won't show up.</p>` : ''}`);
    }

    if (c.arms_in || c.arms_out) {
      const a = meta.arms, per = a.period.replace('-', ' to ');
      const ch = (x) => (x > 0 ? `up ${Math.round(x).toLocaleString('en')}%` : `down ${Math.abs(Math.round(x))}%`);
      let html = `<h3 class="num-h">Weapons <span>${esc(per)}</span></h3>`;
      if (c.arms_in) html += `<p class="web-total">The world's ${ordinal(c.arms_in.rank)}biggest importer of major arms, with ${c.arms_in.share}% of all imports (${ch(c.arms_in.change)} on ${esc(a.previous.replace('-', ' to '))}).</p>
        <ol class="web-bars arms">${c.arms_in.from.map(([p, s]) => `<li><span class="web-who">${esc(flagOf(p))} ${esc(nameOf(p))}</span><span class="web-bar"><i style="width:${s}%"></i></span><span class="web-n">${pctTxt(s)}%</span></li>`).join('')}</ol>`;
      if (c.arms_out) html += `<p class="web-total">The world's ${ordinal(c.arms_out.rank)}biggest arms exporter, with ${c.arms_out.share}% of all exports (${ch(c.arms_out.change)}). Main buyers:</p>
        <ol class="web-bars arms">${c.arms_out.to.map(([p, s]) => `<li><span class="web-who">${esc(flagOf(p))} ${esc(nameOf(p))}</span><span class="web-bar"><i style="width:${s}%"></i></span><span class="web-n">${pctTxt(s)}%</span></li>`).join('')}</ol>`;
      html += `<p class="num-help">${esc(a.note)} <a href="${esc(a.source.url)}" target="_blank" rel="noopener">SIPRI</a></p>`;
      parts.push(html);
    }

    if (c.sanctions && c.sanctions.length) {
      parts.push(`<h3 class="num-h">Sanctions</h3>
        <ul class="web-sanc">${c.sanctions.map((x) => `<li><span class="tchip">${esc(x.by)}</span><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.what)}</a></li>`).join('')}</ul>
        <p class="num-help">EU and UN sanctions regimes tied to ${me}. Some target the government; others target people undermining it, or a foreign power's actions on its soil. US sanctions are not listed.</p>`);
    }

    return `<section class="web"><h2>Connections</h2>${has.trade || has.arms ? switcher : ''}${parts.join('')}
      <p class="web-src">Trade from <a href="${esc(meta.trade.url)}" target="_blank" rel="noopener">UN Comtrade</a>. Arms from <a href="${esc(meta.arms.source.url)}" target="_blank" rel="noopener">SIPRI</a>. Sanctions from the <a href="${esc(meta.sanctions.url)}" target="_blank" rel="noopener">EU Sanctions Map</a>. Blocs from each group's own membership list.</p></section>`;
  }
  const ordinal = (n) => (n === 1 ? '' : `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]} `);

  W.ext.profileSections.push(sectionHtml);
  W.ext.afterProfile.push((d) => {
    current = { id: d.id, d };
    if (view.startsWith('bloc:')) view = 'trade';
    draw();
  });

  const clear = () => { current = null; W.setArcs('web', []); };
  W.on('close', clear);
  W.on('panel', clear);
  W.on('mode', (m) => { if (m !== 'politics') W.setArcs('web', []); else draw(); });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-web]');
    if (!b) return;
    const v = b.dataset.web;
    setView(view === v && v.startsWith('bloc:') ? 'trade' : v);
  });

  W.on('ready', async () => {
    try {
      const x = await fetch('data/connections.json').then((r) => r.json());
      meta = x.meta;
      blocs = new Map(x.blocs.map((b) => [b.id, b]));
    } catch (_) { meta = null; }
    W.rerenderProfile();
  });

  window.WPMConnections = { get blocs() { return blocs; }, setView };
})();
