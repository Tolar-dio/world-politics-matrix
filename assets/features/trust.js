/* Trust layer: last-checked dates and corrections on profiles, and the corrections log with how the site checks facts. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  let log = null;

  W.ext.afterProfile.push((d) => {
    const status = document.querySelector('#profile .status');
    if (status && d.checked) {
      status.textContent = d.depth === 'full'
        ? `${status.textContent.trim()}. Last checked ${d.checked}`
        : `Short profile, last checked ${d.checked}`;
    }
    if (d.corrections && d.corrections.length) {
      const top = document.querySelector('#profile .snapshot') || status;
      if (top) top.insertAdjacentHTML('afterend', `<p class="corrected">${d.corrections.map((c) => `<b>Corrected ${esc(c.date)}.</b> ${esc(c.what)}.`).join(' ')} <a href="#corrections">See the corrections log</a>.</p>`);
    }
  });

  const TYPE = { country: 'Country profile', conflict: 'Conflict', battle: 'Battle', news: 'News', base: 'Base' };

  async function open() {
    if (!log) {
      try { log = (await fetch('data/corrections.json').then((r) => r.json())).corrections; } catch (_) { log = []; }
    }
    const where = (c) => {
      if (c.type === 'country' && W.byId.get(c.id)) return `<button type="button" class="link" data-id="${c.id}">${esc(W.byId.get(c.id).name)}</button>`;
      if (c.type === 'conflict' && W.conflictById.get(c.id)) return `<button type="button" class="link" data-conflict="${c.id}">${esc(W.conflictById.get(c.id).name)}</button>`;
      return esc(TYPE[c.type] || '');
    };
    const rows = log.map((c) => `
      <li class="corr">
        <p class="corr-meta">${esc(c.pretty)}${c.type ? `. ${where(c)}` : ''}</p>
        <h3>${esc(c.what)}</h3>
        ${c.was ? `<p><b>We said.</b> ${c.was}</p>` : ''}
        ${c.now ? `<p><b>Now.</b> ${c.now}</p>` : ''}
        ${c.why ? `<p class="corr-why"><b>Why.</b> ${c.why}</p>` : ''}
        ${c.sources.length ? `<p class="corr-src">${c.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(' · ')}</p>` : ''}
      </li>`).join('');
    W.openPanel({ hash: '#corrections', title: 'How we check', html: `
      ${W.panelTop('How we check', 'Labels, rules and every correction')}
      <p class="snapshot">Everything here is written by an AI working from public reporting, checked against its sources, and updated every day. It will sometimes be wrong. When it is, the fix is made in place and listed below.</p>
      ${W.section('What the labels mean', `<dl class="trust-dl">
        <div><dt><span class="tchip ok">Confirmed</span></dt><dd>A wire service (Reuters, AP, AFP or the BBC) reported it, or two independent outlets did.</dd></div>
        <div><dt><span class="tchip rep">Reported</span></dt><dd>One outlet, or a claim by a government or armed group that nobody has independently verified.</dd></div>
        <div><dt><span class="tchip dis">Disputed</span></dt><dd>Credible sources disagree. The summary gives both versions.</dd></div>
        <div><dt><span class="tchip">Last checked</span></dt><dd>On every profile: the last day the daily update confirmed who holds power and re-read recent news for that country. Every country is re-checked about every ten days.</dd></div>
      </dl>`)}
      ${W.section('The rules', `<ul class="tech">
        <li>Casualty figures, leadership changes, territory changing hands and coups need two independent credible sources, or one wire service or official statement. Otherwise they are left out or labelled as claims.</li>
        <li>Every news item, battle, conflict change and profile update links to its sources.</li>
        <li>After each daily update, a second AI with no stake in the first one's work re-opens the cited sources and checks each new claim against them. Anything a source doesn't support is fixed or removed before it goes live.</li>
        <li>Front lines and zones are hand-drawn approximations from written reporting, never copied from proprietary maps.</li>
        <li>Coordinates come from Wikipedia, GeoHack or official sources. Background sections on culture, daily life and history are general knowledge and say so.</li>
      </ul>`)}
      ${W.section(`Corrections (${log.length})`, log.length ? `<ol class="corr-list">${rows}</ol>` : '<p>No corrections yet.</p>')}` });
  }

  W.ext.routes.push((h) => { if (h !== 'corrections') return false; open(); return true; });
})();
