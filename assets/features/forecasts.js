/* Forecasts: live prediction-market odds on the big questions, and your own calls, scored when they resolve. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  const $ = (s, r = document) => r.querySelector(s);
  const KEY = 'wpm-forecasts';

  let data = { forecasts: [] }, live = new Map(), loaded = false, threads = new Map();

  const mine = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const saveMine = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (_) { /* storage unavailable */ } };
  const pct = (p) => (p == null ? 'n/a' : p < 0.01 ? '<1%' : p > 0.99 ? '>99%' : `${Math.round(p * 100)}%`);

  async function fetchLive() {
    const poly = data.forecasts.filter((f) => f.market.source === 'polymarket');
    const mani = data.forecasts.filter((f) => f.market.source === 'manifold');
    const jobs = [];
    // Polymarket's API takes up to about 20 slugs per request.
    for (let i = 0; i < poly.length; i += 20) {
      const qs = poly.slice(i, i + 20).map((f) => `slug=${encodeURIComponent(f.market.slug)}`).join('&');
      jobs.push(fetch(`https://gamma-api.polymarket.com/markets?${qs}`).then((r) => r.json()).then((list) => {
        for (const m of list) {
          const prices = JSON.parse(m.outcomePrices || '[]').map(Number);
          const outcomes = JSON.parse(m.outcomes || '["Yes","No"]');
          const yes = prices[outcomes.indexOf('Yes')] ?? prices[0];
          let resolved = null;
          if (m.closed && (yes === 1 || yes === 0)) resolved = yes === 1 ? 'yes' : 'no';
          live.set(m.slug, { prob: yes, resolved, url: `https://polymarket.com/market/${m.slug}`, volume: Number(m.volume || 0) });
        }
      }).catch(() => {}));
    }
    for (const f of mani) {
      jobs.push(fetch(`https://api.manifold.markets/v0/slug/${encodeURIComponent(f.market.slug)}`).then((r) => r.json()).then((m) => {
        live.set(f.market.slug, { prob: m.probability, resolved: m.isResolved ? (m.resolution === 'YES' ? 'yes' : m.resolution === 'NO' ? 'no' : null) : null, url: m.url, volume: m.volume });
      }).catch(() => {}));
    }
    await Promise.all(jobs);
  }

  function state(f) {
    const l = live.get(f.market.slug);
    return {
      prob: l ? l.prob : f.snapshot.prob,
      isLive: !!l,
      resolved: f.resolution || (l && l.resolved) || null,
      url: l ? l.url : f.market.source === 'polymarket' ? `https://polymarket.com/market/${f.market.slug}` : `https://manifold.markets/${f.market.slug}`,
    };
  }

  // Brier score: the squared gap between a forecast and what happened. 0 is perfect, 0.25 is a coin flip.
  function scores() {
    const m = mine();
    let you = 0, mkt = 0, n = 0;
    for (const f of data.forecasts) {
      const s = state(f), c = m[f.id];
      if (!s.resolved || !c) continue;
      const o = s.resolved === 'yes' ? 1 : 0;
      you += (c.p - o) ** 2; mkt += (c.market - o) ** 2; n += 1;
    }
    return { n, you: n ? you / n : null, mkt: n ? mkt / n : null, made: Object.keys(m).length };
  }

  function card(f) {
    const s = state(f), c = mine()[f.id];
    const flags = f.countries.map((x) => esc((W.byId.get(x) || {}).flag || '')).join('');
    const res = s.resolved ? `<p class="fc-res ${s.resolved}">Resolved: ${s.resolved === 'yes' ? 'Yes' : 'No'}${c ? `. Your call scored ${((c.p - (s.resolved === 'yes' ? 1 : 0)) ** 2).toFixed(2)}, the market ${((c.market - (s.resolved === 'yes' ? 1 : 0)) ** 2).toFixed(2)} (lower is better)` : ''}.</p>` : '';
    const yours = c ? `<span class="fc-you">You said ${pct(c.p)} on ${esc(W.fmtDate(c.at))}, when the market said ${pct(c.market)}.</span>` : '';
    return `<li class="fc" data-fc="${f.id}">
      <div class="fc-top">
        <div class="fc-q"><b>${esc(f.question)}</b><small>${flags} Decided by ${esc(f.pretty)}</small></div>
        <div class="fc-odds" title="${s.isLive ? 'Live market odds' : `Odds on ${esc(f.snapshot.as_of)}; the live market couldn't be reached`}"><span>${pct(s.prob)}</span><small>${s.isLive ? 'market' : 'as of ' + esc(W.fmtDate(f.snapshot.as_of).replace(/ \d{4}$/, ''))}</small></div>
      </div>
      <div class="fc-bar" aria-hidden="true"><span style="width:${Math.round((s.prob || 0) * 100)}%"></span>${c ? `<i style="left:${Math.round(c.p * 100)}%" title="Your call"></i>` : ''}</div>
      ${f.why ? `<p class="fc-why">${esc(f.why)}</p>` : ''}
      ${res}
      ${s.resolved ? yours : `<div class="fc-mine">
        <label><span>Your call</span><input type="range" min="1" max="99" value="${c ? Math.round(c.p * 100) : Math.round((s.prob || 0.5) * 100)}" data-fc-range="${f.id}" aria-label="Your probability for: ${esc(f.question)}"><output>${c ? pct(c.p) : pct(s.prob)}</output></label>
        <button type="button" class="pbtn" data-fc-save="${f.id}">${c ? 'Update' : 'Lock it in'}</button>
        ${yours}
      </div>`}
      <p class="fc-src"><a href="${esc(s.url)}" target="_blank" rel="noopener">Market on ${f.market.source === 'polymarket' ? 'Polymarket' : 'Manifold'}</a>${f.thread && threads.get(f.thread) ? ` · <button type="button" class="link" data-thread="${f.thread}">${esc(threads.get(f.thread))}</button>` : ''}</p>
    </li>`;
  }

  function scoreCard() {
    const s = scores();
    if (!s.made) return `<p class="fc-intro">Drag a slider to say how likely you think each one is, then lock it in. When the question is decided, your call is scored against the market's odds on the day you made it. Your calls stay in this browser.</p>`;
    if (!s.n) return `<p class="fc-intro">You've made ${s.made} call${s.made === 1 ? '' : 's'}. Scores appear as questions are decided. Your calls stay in this browser.</p>`;
    const better = s.you < s.mkt;
    return `<div class="fc-score"><p><b>${s.n} call${s.n === 1 ? '' : 's'} decided.</b> Your average score is <b>${s.you.toFixed(3)}</b>; the market scored <b>${s.mkt.toFixed(3)}</b> on the same questions. Lower is better, and 0.25 is what always saying 50% gets you.</p><p>${better ? 'You are beating the market.' : 'The market is ahead of you so far.'}</p></div>`;
  }

  async function openPanel() {
    if (!loaded) await init();
    const groups = new Map();
    for (const f of data.forecasts) {
      const g = f.thread && threads.get(f.thread) ? threads.get(f.thread) : 'Other questions';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(f);
    }
    W.openPanel({ hash: '#forecasts', title: 'Forecasts', html: `
      ${W.panelTop('Forecasts', 'What the money expects, and what you expect')}
      <p class="snapshot">The odds come live from prediction markets, where people bet real money on how events turn out. They are not certainties, but they are often a sharper read than pundits.</p>
      ${scoreCard()}
      ${[...groups.entries()].map(([g, list]) => `<h3 class="num-h">${esc(g)}</h3><ul class="fcs">${list.map(card).join('')}</ul>`).join('')}
      <p class="intro-foot">Odds from <a href="https://polymarket.com" target="_blank" rel="noopener">Polymarket</a>, pulled by your browser when you open this page. Prediction markets can be thin, biased toward their users' views, and moved by large bets. A market's "yes" is decided by its own rules, which can differ from how this site phrases the question; read the market for the fine print.</p>` });
  }

  document.addEventListener('input', (ev) => {
    const r = ev.target.closest('[data-fc-range]');
    if (r) { r.dataset.touched = '1'; r.nextElementSibling.textContent = `${r.value}%`; }
  });
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-fc-save]');
    if (!b) return;
    const f = data.forecasts.find((x) => x.id === b.dataset.fcSave);
    const r = document.querySelector(`[data-fc-range="${f.id}"]`);
    const m = mine();
    m[f.id] = { p: +r.value / 100, market: state(f).prob, at: new Date().toISOString().slice(0, 10) };
    saveMine(m);
    const li = b.closest('.fc');
    li.outerHTML = card(f);
    const sc = document.querySelector('.fc-intro, .fc-score');
    if (sc) sc.outerHTML = scoreCard();
    W.emit('forecast', f.id);
  });

  W.ext.profileSections.push((d) => {
    if (!d.forecasts || !d.forecasts.length || !loaded) return '';
    const list = d.forecasts.map((id) => data.forecasts.find((f) => f.id === id)).filter(Boolean);
    return `<section><h2>What the markets expect</h2><ul class="fc-mini">${list.map((f) => { const s = state(f); return `<li><span class="fc-mini-p">${pct(s.prob)}</span><span>${esc(f.question)}</span></li>`; }).join('')}</ul><p class="more-link"><a href="#forecasts">Make your own calls</a></p></section>`;
  });

  W.ext.routes.push((h) => { if (h !== 'forecasts') return false; openPanel(); return true; });

  // Load the questions straight away and show snapshot odds; live odds replace them when they arrive.
  let initP = null;
  function init() {
    if (initP) return initP;
    initP = (async () => {
      try { data = await fetch('data/forecasts.json').then((r) => r.json()); } catch (_) { data = { forecasts: [] }; }
      try { const t = await fetch('data/threads.json').then((r) => r.json()); threads = new Map(t.threads.map((x) => [x.id, x.title])); } catch (_) { /* no storylines */ }
      loaded = true;
      fetchLive().then(refresh);
    })();
    return initP;
  }

  function intro() {
    const el = $('#intro-forecasts');
    if (!el || !data.forecasts.length) return;
    const pick = ['netanyahu-out', 'iran-ceasefire-dec', 'ukraine-ceasefire-dec', 'hormuz-normal-dec'].map((id) => data.forecasts.find((f) => f.id === id)).filter(Boolean);
    el.innerHTML = `<h2 class="intro-h">What the markets expect</h2><ul class="fc-mini">${pick.map((f) => `<li><span class="fc-mini-p">${pct(state(f).prob)}</span><span>${esc(f.question)}</span></li>`).join('')}</ul><p class="more-link"><a href="#forecasts">All ${data.forecasts.length} forecasts, and make your own calls</a></p>`;
  }

  // Live odds arrived: update whatever is on screen without losing scroll or slider positions.
  function refresh() {
    intro();
    if (location.hash === '#forecasts') {
      for (const li of document.querySelectorAll('.fc[data-fc]')) {
        const f = data.forecasts.find((x) => x.id === li.dataset.fc);
        const r = li.querySelector('[data-fc-range]');
        if (r && document.activeElement === r) continue;
        const moved = r && r.dataset.touched;
        const v = r && r.value;
        li.outerHTML = card(f);
        if (moved) { const n = document.querySelector(`[data-fc-range="${f.id}"]`); n.value = v; n.dataset.touched = '1'; n.nextElementSibling.textContent = `${v}%`; }
      }
    }
    W.rerenderProfile();
  }

  W.on('ready', async () => { await init(); intro(); W.rerenderProfile(); });

  window.WPMForecasts = { get data() { return data; }, state, mine, scores };
})();
