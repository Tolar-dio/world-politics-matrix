/* World Politics Matrix: the news page. */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAT_LABEL = { military: 'Military', political: 'Political', diplomatic: 'Diplomatic', economic: 'Economic', humanitarian: 'Humanitarian' };
  const state = { cat: 'all', region: 'all' };
  let news, byId, conflicts;

  function render() {
    const items = news.items.filter((n) => (state.cat === 'all' || n.category === state.cat)
      && (state.region === 'all' || n.countries.some((iso) => (byId.get(iso) || {}).group === state.region)));
    if (!items.length) {
      $('#feed').innerHTML = '<p class="feed-empty">Nothing matches that filter yet.</p>';
      return;
    }
    const days = new Map();
    for (const n of items) {
      if (!days.has(n.date)) days.set(n.date, []);
      days.get(n.date).push(n);
    }
    $('#feed').innerHTML = [...days.entries()].map(([date, list]) => `
      <section class="day">
        <h3 class="day-h">${esc(list[0].pretty)}</h3>
        ${list.map((n) => `
          <article class="item" id="${esc(n.id)}">
            <p class="item-meta"><span class="cat cat-${n.category}">${esc(CAT_LABEL[n.category] || n.category)}</span>
              ${n.countries.map((iso) => byId.get(iso)).filter(Boolean).map((e) => `<a class="ctry" href="./#${e.id}">${esc(e.flag)} ${esc(e.name)}</a>`).join('')}
              ${n.conflict && conflicts.get(n.conflict) ? `<a class="ctry war" href="./#c/${esc(n.conflict)}">${esc(conflicts.get(n.conflict).name)}</a>` : ''}
            </p>
            <h4 class="item-h">${esc(n.headline)}</h4>
            ${n.summary ? `<p class="item-sum">${n.summary}</p>` : ''}
            ${n.sources.length ? `<p class="item-src">${n.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join('')}</p>` : ''}
          </article>`).join('')}
      </section>`).join('');
  }

  function renderUpcoming() {
    $('#upcoming').innerHTML = news.upcoming.length ? news.upcoming.map((u) => `
      <li><span class="up-date">${esc(u.pretty)}</span>
        <p>${u.event}</p>
        <p class="up-ctry">${u.countries.map((iso) => byId.get(iso)).filter(Boolean).map((e) => `<a href="./#${e.id}">${esc(e.flag)} ${esc(e.name)}</a>`).join(' ')}</p>
      </li>`).join('') : '<li><p>Nothing scheduled yet.</p></li>';
    // Phones show the calendar above the feed, so keep it short until asked.
    const extra = news.upcoming.length - 3;
    const more = $('#upcoming-more');
    if (more) more.remove();
    if (extra > 0) {
      $('#upcoming').classList.add('is-clipped');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'upcoming-more';
      btn.className = 'up-more';
      btn.textContent = `Show ${extra} more`;
      btn.addEventListener('click', () => { $('#upcoming').classList.remove('is-clipped'); btn.remove(); });
      $('#upcoming').after(btn);
    }
  }

  async function boot() {
    const [n, idx, mil] = await Promise.all([
      fetch('data/news.json').then((r) => r.json()),
      fetch('data/index.json').then((r) => r.json()),
      fetch('data/military.json').then((r) => (r.ok ? r.json() : { conflicts: [] })).catch(() => ({ conflicts: [] })),
    ]);
    news = n;
    byId = new Map(idx.entities.map((e) => [e.id, e]));
    conflicts = new Map(mil.conflicts.map((c) => [c.id, c]));
    const latest = news.items[0];
    $('#news-updated').textContent = latest ? `Latest entry: ${latest.pretty}. ${news.items.length} stories in the archive.` : 'The first daily update has not run yet.';
    document.querySelectorAll('.news-filters button').forEach((b) => b.addEventListener('click', () => {
      state.cat = b.dataset.cat;
      document.querySelectorAll('.news-filters button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      render();
    }));
    $('#region').addEventListener('change', (ev) => { state.region = ev.target.value; render(); });
    render();
    renderUpcoming();
    if (location.hash) {
      const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el) { el.classList.add('is-target'); el.scrollIntoView({ block: 'center' }); }
    }
  }

  boot().catch((err) => {
    console.error(err);
    $('#feed').innerHTML = '<p class="feed-empty">The news feed failed to load. Reload the page to try again.</p>';
  });
})();
