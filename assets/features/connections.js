/* Connections: who each country is allied with, trades with, buys weapons from, and who sanctions it. Text only: no lines on the globe. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  const $ = (s, r = document) => r.querySelector(s);
  const KEY = 'wpm-web';
  const KIND = { military: 'Defence pacts', union: 'Unions', economic: 'Trade and economic blocs', political: 'Political groups' };

  let meta = null, blocs = new Map(), current = null; // current = {id, d}
  let view = 'trade';
  try { view = localStorage.getItem(KEY) || 'trade'; } catch (_) { /* storage unavailable */ }

  const money = (v) => (v >= 1e12 ? `$${(v / 1e12).toFixed(1)} trillion` : v >= 1e9 ? `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)} billion` : `$${Math.round(v / 1e6)} million`);
  const nameOf = (x) => (W.byId.get(x) || {}).name || x;
  const flagOf = (x) => (W.byId.get(x) || {}).flag || '';
  const pctTxt = (p) => (p >= 10 ? Math.round(p) : p.toFixed(1)).toString();

  // Lines on the globe were removed (too busy). Keep the call sites; just make sure nothing is drawn.
  function draw() { W.setArcs('web', []); }

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
        <p class="num-help">Tap a group to see what it is. Memberships as of ${esc(meta.blocs_as_of)}.</p>`);
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

    return `<section class="web"><h2>Connections</h2>${parts.join('')}
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
