/* Data layers: recolour the globe by an indicator, "By the numbers" in profiles, and side-by-side compare. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  const $ = (s, r = document) => r.querySelector(s);

  // Five-step sequential ramps, light to dark, one hue per family so a lens never implies good or bad.
  const RAMPS = {
    Governance: ['#E1EEEA', '#B3D6CB', '#7DB4A5', '#4A8E7F', '#24645A'],
    Economy: ['#F4ECD2', '#E8D08E', '#D8AE58', '#B48232', '#7C5521'],
    Security: ['#F4E0D8', '#E6B5A5', '#D18672', '#B05640', '#7C3122'],
    People: ['#ECE6F3', '#CDC0E1', '#A894C9', '#7F6AAA', '#574684'],
  };
  const RAMPS_DARK = {
    Governance: ['#2E4440', '#3D6159', '#4F8174', '#6BA392', '#96C9B8'],
    Economy: ['#4A4130', '#6B5A35', '#8F7539', '#B8943F', '#E0BC60'],
    Security: ['#4A3330', '#6B403A', '#8F4E43', '#B66352', '#E08B76'],
    People: ['#3A3548', '#4E4766', '#655A88', '#8274AD', '#A99AD3'],
  };

  let data = null;
  const byInd = new Map();

  const fmt = (v, f) => {
    if (v == null || Number.isNaN(v)) return 'n/a';
    switch (f) {
      case 'dec0': return Math.round(v).toLocaleString('en-US');
      case 'dec1': return v.toFixed(1);
      case 'dec2': return v.toFixed(2);
      case 'usd': return `$${Math.round(v).toLocaleString('en-US')}`;
      case 'usd2': return `$${v < 10 ? v.toFixed(2) : v.toFixed(1)}`;
      case 'pct': return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
      case 'pct0': return `${Math.round(v)}%`;
      case 'pct1': return `${v.toFixed(1)}%`;
      default: return String(v);
    }
  };

  function prep(ind) {
    const ids = new Set(W.index.entities.filter((e) => e.kind === 'country').map((e) => e.id));
    const vals = Object.entries(ind.values).filter(([iso]) => ids.has(iso)).map(([iso, [v]]) => [iso, v]);
    const sorted = vals.map(([, v]) => v).sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)];
    // Rank from the top: 1 is the highest value.
    const desc = vals.slice().sort((a, b) => b[1] - a[1]);
    const rank = new Map(desc.map(([iso], i) => [iso, i + 1]));
    const pct = new Map(vals.map(([iso, v]) => [iso, sorted.filter((x) => x < v).length / Math.max(1, sorted.length - 1)]));
    return { ...ind, cuts, rank, pct, n: vals.length, min: sorted[0], max: sorted[sorted.length - 1] };
  }

  const binOf = (ind, v) => ind.cuts.filter((c) => v >= c).length;
  const ramp = (ind) => (W.isDark() ? RAMPS_DARK : RAMPS)[ind.group] || RAMPS.People;

  function legendFor(ind) {
    const r = ramp(ind);
    const counts = [0, 0, 0, 0, 0];
    let none = 0;
    for (const e of W.index.entities) {
      if (e.kind !== 'country') continue;
      const v = ind.values[e.id];
      if (v) counts[binOf(ind, v[0])] += 1; else none += 1;
    }
    const edges = [ind.min, ...ind.cuts, ind.max];
    const rows = r.map((c, i) => `<li><span class="swatch" style="background:${c}"></span>${esc(fmt(edges[i], ind.format))} to ${esc(fmt(edges[i + 1], ind.format))} <span class="n">${counts[i]}</span></li>`);
    if (none) rows.push(`<li><span class="swatch" style="background:${W.cssVar('--quiet')}"></span>No data <span class="n">${none}</span></li>`);
    rows.push(`<li class="legend-note">${esc(ind.note)} <a href="${esc(ind.url)}" target="_blank" rel="noopener">${esc(ind.source)}</a></li>`);
    return rows.join('');
  }

  function registerAll() {
    for (const raw of data.indicators) {
      const ind = prep(raw);
      byInd.set(ind.id, ind);
      W.registerLens(`data:${ind.id}`, {
        title: `${ind.title} (${ind.unit})`,
        short: ind.title,
        color: (e) => { const v = ind.values[e.id]; return v ? ramp(ind)[binOf(ind, v[0])] : W.cssVar('--quiet'); },
        label: (e) => { const v = ind.values[e.id]; return v ? `${ind.title}: ${fmt(v[0], ind.format)} (${v[1]})` : `${ind.title}: no data`; },
        legend: () => legendFor(ind),
      });
    }
  }

  /* ---------- the Data button in the lens switch ---------- */
  function buildPicker() {
    const sw = $('.lens-switch');
    if (!sw || $('#data-lens-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'data-lens-btn';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.setAttribute('aria-haspopup', 'true');
    btn.dataset.lensData = '1';
    btn.textContent = 'Data';
    sw.appendChild(btn);
    const pop = document.createElement('div');
    pop.className = 'data-pop';
    pop.id = 'data-pop';
    pop.hidden = true;
    const groups = [...new Set(data.indicators.map((i) => i.group))];
    pop.innerHTML = groups.map((g) => `
      <div class="data-group"><p class="data-group-h">${esc(g)}</p>
        ${data.indicators.filter((i) => i.group === g).map((i) => `<button type="button" data-ind="${i.id}"><span class="swatch" style="background:${RAMPS[g][3]}"></span>${esc(i.title)}</button>`).join('')}
      </div>`).join('') + '<p class="data-pop-foot">Countries are split into five equal-sized groups for each measure.</p>';
    $('#politics-controls').insertBefore(pop, $('#politics-controls').children[1]);
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); pop.hidden = !pop.hidden; });
    pop.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-ind]');
      if (!b) return;
      W.setLens(`data:${b.dataset.ind}`);
      pop.hidden = true;
    });
    document.addEventListener('click', (ev) => { if (!pop.hidden && !pop.contains(ev.target) && ev.target !== btn) pop.hidden = true; });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') pop.hidden = true; });
  }

  W.on('lens', (name) => {
    const btn = $('#data-lens-btn');
    if (!btn) return;
    const on = name.startsWith('data:');
    btn.setAttribute('aria-checked', String(on));
    btn.textContent = on ? `Data: ${byInd.get(name.slice(5))?.title || ''}` : 'Data';
    if (on) { const sw = btn.parentElement; sw.scrollLeft = btn.offsetLeft; }
    document.querySelectorAll('#data-pop button[data-ind]').forEach((b) => b.classList.toggle('on', `data:${b.dataset.ind}` === name));
  });

  /* ---------- profile: By the numbers ---------- */
  function numbersFor(iso) {
    if (!data) return '';
    const groups = [...new Set(data.indicators.map((i) => i.group))];
    const blocks = groups.map((g) => {
      const rows = data.indicators.filter((i) => i.group === g).map((i) => byInd.get(i.id)).filter((ind) => ind && ind.values[iso]).map((ind) => {
        const [v, y] = ind.values[iso];
        const p = ind.pct.get(iso) ?? 0;
        return `<li>
          <button type="button" class="num-row" data-lens-pick="${ind.id}" title="Colour the globe by ${esc(ind.title.toLowerCase())}">
            <span class="num-label">${esc(ind.title)}<small>${esc(ind.unit)}, ${y}</small></span>
            <span class="num-val">${esc(fmt(v, ind.format))}</span>
            <span class="num-bar" aria-hidden="true"><span style="left:${(p * 100).toFixed(1)}%;background:${ramp(ind)[3]}"></span></span>
            <span class="num-rank">${ordinal(ind.rank.get(iso))} of ${ind.n}</span>
          </button></li>`;
      });
      return rows.length ? `<h3 class="num-h">${esc(g)}</h3><ul class="nums">${rows.join('')}</ul>` : '';
    }).join('');
    if (!blocks) return '';
    return `<section><h2>By the numbers</h2>
      <p class="num-help">Each bar shows where the country sits among all countries with data, lowest on the left. Rank 1 is the highest value. Tap a row to colour the globe by it.</p>
      ${blocks}
      <p class="sov-link"><button type="button" class="btn" data-compare="${iso}">Compare with another country</button></p></section>`;
  }

  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  W.ext.profileSections.push((d) => numbersFor(d.id));

  /* ---------- compare ---------- */
  let compare = null; // [isoA, isoB]

  W.ext.colorOverrides.push((e) => {
    if (!compare) return null;
    if (e.id === compare[0]) return W.isDark() ? '#E8C76A' : '#C8962E';
    if (e.id === compare[1]) return W.isDark() ? '#8FC3DD' : '#3E6A86';
    return null;
  });

  function countryOptions(exclude) {
    return W.index.entities.filter((e) => e.kind === 'country' && e.id !== exclude).sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `<option value="${esc(e.name)}" data-id="${e.id}"></option>`).join('');
  }

  async function openCompare(a, b) {
    const A = W.byId.get(a), B = b && W.byId.get(b);
    if (!A) return;
    compare = B ? [a, b] : [a, null];
    W.refreshPolygons();
    const hash = B ? `#compare/${a}/${b}` : `#compare/${a}`;
    const head = (e, cls) => `<div class="cmp-head ${cls}"><span class="cmp-flag">${esc(e.flag)}</span><button type="button" class="link" data-id="${e.id}">${esc(e.name)}</button></div>`;
    if (!B) {
      W.openPanel({ hash, title: `Compare ${A.name}`, html: `
        ${W.panelTop(`Compare ${A.name}`, 'Pick a second country to set beside it.', esc(A.flag))}
        <label class="cmp-pick"><span>Compare with</span>
          <input type="text" id="cmp-input" list="cmp-list" placeholder="Type a country" autocomplete="off">
          <datalist id="cmp-list">${countryOptions(a)}</datalist></label>
        <p class="cmp-suggest">Or try one of its neighbours in the data: ${suggestions(a).map((e) => `<button type="button" class="link" data-cmp-b="${e.id}">${esc(e.name)}</button>`).join(', ')}</p>` });
      const input = $('#cmp-input');
      input.focus();
      input.addEventListener('change', () => {
        const opt = [...document.querySelectorAll('#cmp-list option')].find((o) => o.value.toLowerCase() === input.value.trim().toLowerCase());
        if (opt) openCompare(a, opt.dataset.id);
      });
      return;
    }
    const [dA, dB] = await Promise.all([W.loadDetail(a).catch(() => ({})), W.loadDetail(b).catch(() => ({}))]);
    const rowFacts = (label, x, y) => `<tr><th scope="row">${esc(label)}</th><td>${x || '<span class="cmp-na">n/a</span>'}</td><td>${y || '<span class="cmp-na">n/a</span>'}</td></tr>`;
    const sysLabel = (k) => (W.LENSES.system.items.find(([key]) => key === k) || [])[1];
    const lead = (e) => (e.leader ? `${esc(e.leader)}${e.since ? `, since ${e.since}` : ''}` : '');
    const facts = [
      rowFacts('Leader', lead(A), lead(B)),
      rowFacts('System', esc(sysLabel(A.system) || ''), esc(sysLabel(B.system) || '')),
      rowFacts('Population', esc(dA.facts?.population || ''), esc(dB.facts?.population || '')),
      rowFacts('Capital', esc(dA.facts?.capital || ''), esc(dB.facts?.capital || '')),
      rowFacts('Area', esc(dA.facts?.area || ''), esc(dB.facts?.area || '')),
    ].join('');
    const groups = [...new Set(data.indicators.map((i) => i.group))];
    const ind = groups.map((g) => {
      const rows = data.indicators.filter((i) => i.group === g).map((i) => byInd.get(i.id)).filter((x) => x.values[a] || x.values[b]).map((x) => {
        const va = x.values[a], vb = x.values[b];
        const bar = (iso, v, cls) => (v ? `<span class="cmp-bar ${cls}"><span style="width:${Math.max(3, (x.pct.get(iso) || 0) * 100).toFixed(1)}%"></span></span>` : '');
        const cell = (iso, v, cls) => (v ? `${esc(fmt(v[0], x.format))}<small>${v[1]}</small>${bar(iso, v, cls)}` : '<span class="cmp-na">n/a</span>');
        return `<tr><th scope="row">${esc(x.title)}<small>${esc(x.unit)}</small></th><td>${cell(a, va, 'a')}</td><td>${cell(b, vb, 'b')}</td></tr>`;
      }).join('');
      return rows ? `<tr class="cmp-group"><th colspan="3">${esc(g)}</th></tr>${rows}` : '';
    }).join('');
    W.openPanel({ hash, title: `${A.name} and ${B.name}`, html: `
      ${W.panelTop(`${A.name} and ${B.name}`, 'Side by side. Bars show where each sits among all countries with data.')}
      <div class="cmp-heads">${head(A, 'a')}${head(B, 'b')}</div>
      <table class="cmp"><thead><tr><th></th><th class="a">${esc(A.name)}</th><th class="b">${esc(B.name)}</th></tr></thead>
      <tbody>${facts}${ind}</tbody></table>
      <p class="sov-link"><button type="button" class="btn" data-compare="${a}">Compare ${esc(A.name)} with someone else</button></p>
      <p class="intro-foot">Sources: ${[...new Set(data.indicators.map((i) => i.source.replace(/, via Our World in Data$/, '')))].map(esc).join('; ')}. Most figures via <a href="https://ourworldindata.org" target="_blank" rel="noopener">Our World in Data</a>. Indicators fetched ${esc(data.fetched)}.</p>` });
  }

  // Countries most like this one across the indicators, as quick picks.
  function suggestions(a) {
    const inds = [...byInd.values()];
    const dist = (b) => {
      let s = 0, n = 0;
      for (const x of inds) { const pa = x.pct.get(a), pb = x.pct.get(b); if (pa != null && pb != null) { s += (pa - pb) ** 2; n += 1; } }
      return n > 6 ? s / n : Infinity;
    };
    return W.index.entities.filter((e) => e.kind === 'country' && e.id !== a).map((e) => [dist(e.id), e]).sort((x, y) => x[0] - y[0]).slice(0, 4).map(([, e]) => e);
  }

  W.ext.routes.push((h) => {
    const m = h.match(/^compare\/([A-Z]{3})(?:\/([A-Z]{3}))?$/);
    if (!m) return false;
    if (!data) { pendingRoute = h; return true; }
    openCompare(m[1], m[2]);
    return true;
  });
  let pendingRoute = null;

  W.on('close', () => { if (compare) { compare = null; } });
  W.on('select', () => { compare = null; });

  document.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-compare]');
    if (c) { ev.preventDefault(); openCompare(c.dataset.compare); return; }
    const cb = ev.target.closest('[data-cmp-b]');
    if (cb && compare) { ev.preventDefault(); openCompare(compare[0], cb.dataset.cmpB); return; }
    const pick = ev.target.closest('[data-lens-pick]');
    if (pick) { ev.preventDefault(); W.setLens(`data:${pick.dataset.lensPick}`); }
  });

  W.on('ready', async () => {
    try {
      data = await fetch('data/indicators.json').then((r) => (r.ok ? r.json() : null));
    } catch (_) { data = null; }
    if (!data) return;
    registerAll();
    buildPicker();
    const saved = W.state.savedLens;
    if (saved && saved.startsWith('data:') && W.LENSES[saved]) W.setLens(saved);
    if (pendingRoute) {
      const m = pendingRoute.match(/^compare\/([A-Z]{3})(?:\/([A-Z]{3}))?$/);
      pendingRoute = null;
      openCompare(m[1], m[2]);
      return;
    }
    // A profile opened before the data arrived gets its numbers now.
    W.rerenderProfile();
  });

  window.WPMLayers = { fmt, get data() { return data; }, byInd };
})();
