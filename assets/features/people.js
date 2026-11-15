/* People: everyday life (food, music, what people argue about, how to say hello, what money looks like),
   how the country got here, and the country in its own voice. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  let ind = null;

  /* ---------- money, from the data layers ---------- */
  function moneyLine(id) {
    if (!ind) return '';
    const v = (k) => { const i = ind.get(k); return i && i.values[id] ? i.values[id] : null; };
    const inc = v('income'), gdp = v('gdp_pc'), pov = v('poverty');
    const bits = [];
    if (inc) bits.push(`Half of people live on less than <b>$${inc[0] < 10 ? inc[0].toFixed(2) : Math.round(inc[0])} a day</b> (${inc[1]}), counting what that buys locally.`);
    if (pov && pov[0] >= 1) bits.push(`About <b>${Math.round(pov[0])}%</b> live on under $3 a day.`);
    if (gdp) bits.push(`The economy produces about <b>$${Math.round(gdp[0]).toLocaleString('en')}</b> per person a year (${gdp[1]}).`);
    return bits.length ? `<p class="ppl-money">${bits.join(' ')}</p><p class="num-help">Adjusted for local prices. From the World Bank via <a href="https://ourworldindata.org" target="_blank" rel="noopener">Our World in Data</a>.</p>` : '';
  }

  /* ---------- saying it out loud ---------- */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  function voiceFor(lang) {
    if (!synth) return null;
    const vs = synth.getVoices(), base = lang.split('-')[0].toLowerCase();
    return vs.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) || vs.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base) || null;
  }

  function sayHtml(s) {
    if (!s) return '';
    return `<h3 class="num-h">Say it <span>${esc(s.name)}</span></h3><ul class="ppl-say">${s.phrases.map(([p, m, how]) => `<li>
      ${synth ? `<button type="button" class="ppl-speak" data-say="${esc(p)}" data-lang="${esc(s.lang)}" aria-label="Hear ${esc(p)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6h2.5L9 3v10L5.5 10H3z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.6 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>` : ''}
      <span class="ppl-p"><b lang="${esc(s.lang)}">${esc(p)}</b><small>${esc(m)}${how ? ` · say <i>${esc(how)}</i>` : ''}</small></span></li>`).join('')}</ul>`;
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-say]');
    if (!b || !synth) return;
    const u = new SpeechSynthesisUtterance(b.dataset.say);
    u.lang = b.dataset.lang;
    const v = voiceFor(b.dataset.lang);
    if (v) u.voice = v;
    u.rate = 0.85;
    synth.cancel();
    synth.speak(u);
    if (!v) {
      const li = b.closest('li');
      if (li && !li.querySelector('.ppl-novoice')) li.insertAdjacentHTML('beforeend', '<small class="ppl-novoice">Your device has no voice for this language, so the accent will be off.</small>');
    }
  });

  /* ---------- good news ---------- */
  function goodNews(id) {
    const items = (W.news.items || []).filter((n) => n.good && (n.countries || []).includes(id)).sort((a, b) => b.date.localeCompare(a.date));
    if (!items.length) return '';
    return `<h3 class="num-h">Good news</h3><ul class="news-mini">${items.slice(0, 2).map((n) => `<li><span class="news-date">${esc(W.fmtDate(n.date).replace(/ \d{4}$/, ''))}</span><a href="news.html#${esc(n.id)}">${esc(n.headline)}</a></li>`).join('')}</ul>`;
  }

  const list = (title, arr) => (arr && arr.length ? `<h3 class="num-h">${title}</h3><ul class="ppl-list">${arr.map((x) => `<li>${x}</li>`).join('')}</ul>` : '');

  W.ext.profileSections.push((d) => {
    const p = d.people;
    const money = moneyLine(d.id), good = goodNews(d.id);
    if (!p && !money && !good) return '';
    return `<section class="ppl"><h2>Everyday life</h2>
      ${p ? list('What people eat', p.eat) + list('What people listen to', p.listen) + list('What people argue about', p.argue) + sayHtml(p.say) : ''}
      ${money ? `<h3 class="num-h">Money</h3>${money}` : ''}
      ${good}
    </section>`;
  });

  W.ext.profileSections.push((d) => {
    const h = d.past;
    if (!h) return '';
    return `<section class="past"><h2>How it got here</h2>${h.story.map((x) => `<p>${x}</p>`).join('')}
      <ol class="timeline past-tl">${h.timeline.map(([y, e]) => `<li><span>${esc(y)}</span><p>${e}</p></li>`).join('')}</ol></section>`;
  });

  W.ext.profileSections.push((d) => {
    const v = d.voices;
    if (!v) return '';
    const block = (title, help, items) => (items && items.length ? `<h3 class="num-h">${title}</h3><p class="num-help">${help}</p><ul class="voice-list">${items.map((x) => `<li><blockquote>${x.text}</blockquote><p class="voice-by">${x.src && x.who.startsWith(x.src) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.who)}</a>` : `${esc(x.who)}${x.who ? ', ' : ''}<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.src || 'source')}</a>`}, ${esc(x.pretty)}</p></li>`).join('')}</ul>` : '');
    return `<section class="voices"><h2>In its own voice</h2>
      ${block('What its leaders say', 'In their words, or closely paraphrased, with the original linked.', v.leader)}
      ${block('What its own press is saying', 'Summarised and translated from local outlets.', v.press)}
      ${block('How others see it', 'Views from abroad, for contrast.', v.abroad)}
    </section>`;
  });

  W.on('ready', async () => {
    try {
      const x = await fetch('data/indicators.json').then((r) => r.json());
      ind = new Map(x.indicators.map((i) => [i.id, i]));
    } catch (_) { ind = null; }
    W.rerenderProfile();
  });
})();
