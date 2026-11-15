/* Passport: which countries you've opened and read, a country of the day, and a quiz that comes back to what you forget. */
(() => {
  'use strict';
  const W = window.WPM;
  const { esc } = W;
  const $ = (s, r = document) => r.querySelector(s);
  const KEY = 'wpm-passport';
  const READ_SECS = 40;                 // this long on a profile, or reading most of it, counts as read
  const GAPS = [1, 3, 7, 16, 35];       // days until a card comes back, by how many times in a row you got it right
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

  /* ---------- storage ---------- */
  // v: {ISO: [first, last, opens, seconds]}, q: {cardId: [box, due]}, days: [YYYY-MM-DD, ...]
  let pp = load();
  function load() {
    try { const x = JSON.parse(localStorage.getItem(KEY) || '{}'); return { v: x.v || {}, q: x.q || {}, days: x.days || [] }; } catch (_) { return { v: {}, q: {}, days: [] }; }
  }
  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const write = () => { try { localStorage.setItem(KEY, JSON.stringify(pp)); } catch (_) { /* storage unavailable */ } };
    if (now) write(); else saveTimer = setTimeout(write, 800);
  }
  const countries = () => W.index.entities.filter((e) => e.kind === 'country');
  const isRead = (id) => (pp.v[id] || [])[3] >= READ_SECS;
  const isOpened = (id) => !!pp.v[id];

  function touchDay() {
    const d = today();
    if (pp.days[pp.days.length - 1] !== d) { pp.days.push(d); pp.days = pp.days.slice(-120); }
  }
  function streak() {
    if (!pp.days.length) return 0;
    let n = 0, d = today();
    if (pp.days[pp.days.length - 1] !== d) d = addDays(d, -1);
    const set = new Set(pp.days);
    while (set.has(d)) { n += 1; d = addDays(d, -1); }
    return n;
  }

  /* ---------- tracking ---------- */
  W.on('select', (id) => {
    const e = W.byId.get(id);
    if (!e || e.kind !== 'country') return;
    const v = pp.v[id] || [today(), today(), 0, 0];
    v[1] = today(); v[2] += 1;
    pp.v[id] = v;
    touchDay();
    save();
    if (W.state.lens === 'passport') { W.refreshPolygons(); W.renderLegend(); }
  });
  function addSecs(id, s) {
    const v = pp.v[id];
    if (!v) return;
    const was = v[3] >= READ_SECS;
    v[3] = Math.min(v[3] + s, 99999);
    save();
    if (!was && v[3] >= READ_SECS && W.state.lens === 'passport') { W.refreshPolygons(); W.renderLegend(); }
  }
  const reading = () => {
    const id = W.state.selected;
    return id && !document.hidden && !$('#profile').hidden && pp.v[id] ? id : null;
  };
  setInterval(() => { const id = reading(); if (id) addSecs(id, 5); }, 5000);
  document.addEventListener('scroll', (ev) => {
    if (ev.target.id !== 'sheet-scroll') return;
    const id = reading(), el = ev.target;
    if (id && !isRead(id) && el.scrollTop + el.clientHeight >= el.scrollHeight * 0.7) addSecs(id, READ_SECS);
  }, true);

  /* ---------- the passport lens ---------- */
  const SHADES = () => (W.isDark() ? { read: '#E2B65A', opened: '#7E6738' } : { read: '#A8741F', opened: '#E6CF97' });
  W.registerLens('passport', {
    title: 'Your passport',
    color: (e) => (e.kind !== 'country' ? null : isRead(e.id) ? SHADES().read : isOpened(e.id) ? SHADES().opened : W.cssVar('--quiet')),
    label: (e) => {
      const v = pp.v[e.id];
      if (!v) return 'Not opened yet';
      return `${isRead(e.id) ? 'Read' : 'Opened'}${v[2] > 1 ? `, ${v[2]} visits` : ''}. First opened ${W.fmtDate(v[0])}`;
    },
    legend: () => {
      const all = countries(), read = all.filter((e) => isRead(e.id)).length, opened = all.filter((e) => isOpened(e.id)).length;
      return `<li><span class="swatch" style="background:${SHADES().read}"></span>Read <span class="n">${read}</span></li>
        <li><span class="swatch" style="background:${SHADES().opened}"></span>Opened <span class="n">${opened - read}</span></li>
        <li><span class="swatch" style="background:${W.cssVar('--quiet')}"></span>Not opened yet <span class="n">${all.length - opened}</span></li>
        <li class="legend-note">Kept in this browser only. <a href="#passport">Your passport</a></li>`;
    },
  });

  /* ---------- country of the day, and a nudge ---------- */
  function seeded(seed) { // small deterministic PRNG, so everyone gets the same country on the same day
    let h = 2166136261;
    for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1e6) / 1e6; };
  }
  function countryOfDay() {
    const pool = countries().filter((e) => e.depth === 'full').sort((a, b) => a.id.localeCompare(b.id));
    return pool[Math.floor(seeded(today())() * pool.length)];
  }
  function unopened(n) {
    // Countries in this week's news come first: they're the ones worth knowing now.
    const week = addDays(today(), -7), hot = new Map();
    for (const it of W.news.items) if (it.date >= week) for (const c of it.countries || []) hot.set(c, (hot.get(c) || 0) + 1);
    const rnd = seeded(`nudge${today()}`);
    return countries().filter((e) => !isOpened(e.id))
      .map((e) => [e, (hot.get(e.id) || 0) + rnd()]).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
  }

  function renderToday() {
    const el = $('#intro-today');
    if (!el) return;
    const c = countryOfDay();
    const opened = countries().filter((e) => isOpened(e.id)).length;
    const nudge = unopened(5).filter((e) => e.id !== c.id).slice(0, 4);
    el.innerHTML = `<h2 class="intro-h">Country of the day</h2>
      <a class="cotd" href="#${c.id}"><span class="cotd-flag" aria-hidden="true">${esc(c.flag)}</span><span><b>${esc(c.name)}</b><span>${esc(c.snapshot || '')}</span></span></a>
      <div class="pp-strip">
        <p>${opened ? `You've opened <b>${opened}</b> of ${countries().length} countries.` : 'Your passport is empty. Every country you open gets stamped.'} <a href="#passport">Your passport</a></p>
        ${nudge.length ? `<p class="pp-nudge">Not opened yet: ${nudge.map((e) => `<a href="#${e.id}">${esc(e.flag)} ${esc(e.name)}</a>`).join('')}</p>` : ''}
      </div>`;
  }

  /* ---------- passport panel ---------- */
  function openPassport() {
    const all = countries();
    const read = all.filter((e) => isRead(e.id)), opened = all.filter((e) => isOpened(e.id));
    const regions = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'].map((r) => {
      const list = all.filter((e) => e.region === r);
      return { r, n: list.length, read: list.filter((e) => isRead(e.id)).length, opened: list.filter((e) => isOpened(e.id)).length };
    });
    const recent = Object.entries(pp.v).sort((a, b) => b[1][1].localeCompare(a[1][1]) || b[1][2] - a[1][2]).slice(0, 10)
      .map(([id, v]) => [W.byId.get(id), v]).filter((x) => x[0]);
    const due = dueCards().length, mastered = Object.values(pp.q).filter((x) => x[0] >= 4).length;
    const s = streak();
    W.openPanel({ hash: '#passport', title: 'Your passport', html: `
      ${W.panelTop('Your passport', 'Every country you open gets stamped')}
      <div class="pp-stats">
        <div><b>${opened.length}</b><span>of ${all.length} opened</span></div>
        <div><b>${read.length}</b><span>read properly</span></div>
        <div><b>${s}</b><span>day${s === 1 ? '' : 's'} in a row</span></div>
      </div>
      <p class="num-help">A country counts as read once you've spent ${READ_SECS} seconds on it or scrolled through most of its profile.</p>
      <p><button type="button" class="pbtn" data-pp-lens>Show my passport on the globe</button></p>
      ${W.section('By region', `<ul class="pp-regions">${regions.map((x) => `<li><span class="pp-r">${x.r}</span><span class="pp-bar" role="img" aria-label="${x.read} read and ${x.opened - x.read} opened of ${x.n}"><i style="width:${(x.read / x.n) * 100}%"></i><i class="o" style="width:${((x.opened - x.read) / x.n) * 100}%"></i></span><span class="pp-n">${x.opened}/${x.n}</span></li>`).join('')}</ul>`)}
      ${W.section('Quiz yourself', `<p>${Object.keys(pp.q).length ? `${due ? `<b>${due} question${due === 1 ? '' : 's'}</b> due for review.` : 'Nothing due for review right now.'} ${mastered} learned so far.` : 'Ten quick questions on capitals, leaders, flags, money and how countries are run. Ones you miss come back sooner; ones you know come back less often, until they stick.'}</p><p><a class="pbtn" href="#quiz">${Object.keys(pp.q).length ? 'Start a round' : 'Take the first quiz'}</a></p>`)}
      ${W.section('Still to visit', `<ul class="pp-chips">${unopened(12).map((e) => `<li><a href="#${e.id}">${esc(e.flag)} ${esc(e.name)}</a></li>`).join('')}</ul><p class="num-help">Countries in this week's news come first.</p>`)}
      ${recent.length ? W.section('Recently opened', `<ul class="pp-recent">${recent.map(([e, v]) => `<li><a href="#${e.id}">${esc(e.flag)} ${esc(e.name)}</a><span>${isRead(e.id) ? 'Read' : 'Opened'} · ${esc(W.fmtDate(v[1]).replace(/ \d{4}$/, ''))}</span></li>`).join('')}</ul>`) : ''}
      <p class="intro-foot">Your passport lives in this browser only. Nothing is sent anywhere. <button type="button" class="link" data-pp-reset>Erase it</button></p>` });
  }

  /* ---------- quiz ---------- */
  let facts = {}, indicators = [];
  const sysLabel = new Map((W.LENSES.system.items || []).map(([k, l]) => [k, l]));
  const TYPES = ['cap', 'lead', 'flag', 'sys', 'money', 'capof'];

  function shuffle(a, rnd = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // Wrong answers come from the same region where possible, so the question isn't given away.
  function distractors(e, valueOf, n = 3) {
    const right = valueOf(e);
    const same = shuffle(countries().filter((x) => x.id !== e.id && x.region === e.region));
    const rest = shuffle(countries().filter((x) => x.id !== e.id && x.region !== e.region));
    const out = [];
    for (const x of [...same, ...rest]) {
      const v = valueOf(x);
      if (v && v !== right && !out.includes(v)) out.push(v);
      if (out.length === n) break;
    }
    return out;
  }
  const okLeader = (e) => e.leader && e.leader.length < 40 && !/,|vacant|council/i.test(e.leader);

  function makeCard(type, id) {
    const e = W.byId.get(id), f = facts[id] || {};
    if (!e) return null;
    const q = (prompt, answer, valueOf, explain, big = '') => {
      const wrong = distractors(e, valueOf);
      if (!answer || wrong.length < 3) return null;
      return { id: `${type}:${id}`, iso: id, prompt, big, answer, options: shuffle([answer, ...wrong]), explain };
    };
    switch (type) {
      case 'cap': return q(`What is the capital of ${e.name}?`, f.capital, (x) => (facts[x.id] || {}).capital, `The capital of ${e.name} is ${f.capital}.`);
      case 'capof': return f.capital && !f.capital.includes(',') ? q(`${f.capital} is the capital of which country?`, e.name, (x) => x.name, `${f.capital} is the capital of ${e.name}.`) : null;
      case 'lead': return okLeader(e) ? q(`Who holds power in ${e.name}?`, e.leader, (x) => (okLeader(x) ? x.leader : null), `${e.leader} has led ${e.name}${e.since ? ` since ${e.since}` : ''}.`) : null;
      case 'flag': return e.flag ? q('Whose flag is this?', e.name, (x) => x.name, `That's the flag of ${e.name}.`, e.flag) : null;
      case 'sys': return sysLabel.get(e.system) && e.system !== 'contested' ? q(`How is ${e.name} run?`, sysLabel.get(e.system), (x) => sysLabel.get(x.system), `${e.name}: ${sysLabel.get(e.system).toLowerCase()}.`) : null;
      case 'money': return f.currency ? q(`Which currency does ${e.name} use?`, f.currency, (x) => (facts[x.id] || {}).currency, `${e.name} uses the ${f.currency.replace(/^the /i, '')}.`) : null;
      default: return null;
    }
  }

  // A bonus question comparing two countries on a real measure. Not scheduled; it's there to surprise.
  function compareCard() {
    const ASK = { life_exp: 'Where do people live longer, on average?', gdp_pc: 'Which is richer per person?', median_age: 'Which has the older population?',
      internet: 'Where are more people online?', urban: 'Where do more people live in cities?', fertility: 'Where do women have more children, on average?',
      happiness: 'Where are people more satisfied with their lives?', homicide: 'Which has the higher murder rate?' };
    const ok = indicators.filter((i) => ASK[i.id]);
    if (!ok.length) return null;
    const pool = countries().filter((e) => isOpened(e.id));
    const base = pool.length >= 2 ? pool : countries();
    for (let tries = 0; tries < 40; tries++) {
      const ind = ok[Math.floor(Math.random() * ok.length)];
      const [a, b] = shuffle(base.slice()).slice(0, 2);
      if (!a || !b) return null;
      const va = ind.values[a.id], vb = ind.values[b.id];
      if (!va || !vb || Math.abs(va[0] - vb[0]) / Math.max(Math.abs(va[0]), Math.abs(vb[0])) < 0.15) continue;
      const hi = va[0] > vb[0] ? a : b;
      const fmt = (v) => (ind.format === 'usd' ? `$${Math.round(v).toLocaleString('en')}` : ind.format.startsWith('pct') ? `${Math.round(v)}%` : ind.format === 'dec2' ? v.toFixed(2) : v.toFixed(1));
      return { id: null, iso: hi.id, prompt: ASK[ind.id], big: '', answer: hi.name, options: shuffle([a.name, b.name]),
        explain: `${ind.title}: ${a.name} ${fmt(va[0])}, ${b.name} ${fmt(vb[0])} (${ind.unit}; ${ind.source}).` };
    }
    return null;
  }

  function dueCards() {
    const t = today();
    return Object.entries(pp.q).filter(([, x]) => x[1] <= t).sort((a, b) => a[1][1].localeCompare(b[1][1])).map(([id]) => id);
  }

  function buildRound(n = 10) {
    const out = [], used = new Set();
    const push = (c) => { if (c && !used.has(c.id)) { used.add(c.id); out.push(c); } };
    for (const id of dueCards()) { if (out.length >= 7) break; const [type, iso] = id.split(':'); push(makeCard(type, iso)); }
    // New cards: countries you've opened first, then anywhere.
    const opened = shuffle(Object.keys(pp.v)), rest = shuffle(countries().map((e) => e.id).filter((id) => !pp.v[id]));
    for (const iso of [...opened, ...rest]) {
      if (out.length >= n - 1) break;
      for (const type of shuffle(TYPES.slice())) { if (!pp.q[`${type}:${iso}`]) { const c = makeCard(type, iso); if (c) { push(c); break; } } }
    }
    push(compareCard());
    return shuffle(out).slice(0, n);
  }

  let round = null;
  async function openQuiz() {
    if (!facts.FRA) W.openPanel({ hash: '#quiz', title: 'Quiz', html: `${W.panelTop('Quiz', 'Getting questions ready')}<p class="lead-in">Loading</p>` });
    await loadQuizData();
    round = { cards: buildRound(), i: 0, right: 0, answered: false };
    renderQuestion();
  }
  function renderQuestion() {
    const c = round.cards[round.i];
    if (!c) return renderEnd();
    round.answered = false;
    W.openPanel({ hash: '#quiz', title: 'Quiz', html: `
      ${W.panelTop('Quiz', `Question ${round.i + 1} of ${round.cards.length}`)}
      <div class="qz-prog" aria-hidden="true"><i style="width:${(round.i / round.cards.length) * 100}%"></i></div>
      <div class="qz">
        <p class="qz-q">${esc(c.prompt)}</p>
        ${c.big ? `<p class="qz-big" aria-label="A flag">${esc(c.big)}</p>` : ''}
        <ol class="qz-opts">${c.options.map((o, k) => `<li><button type="button" data-qz="${k}"><kbd>${k + 1}</kbd><span>${esc(o)}</span></button></li>`).join('')}</ol>
        <div class="qz-after" hidden></div>
      </div>
      <p class="intro-foot"><a href="#passport">Back to your passport</a></p>` });
  }
  function answer(k) {
    if (!round || round.answered) return;
    const c = round.cards[round.i];
    round.answered = true;
    const ok = c.options[k] === c.answer;
    if (ok) round.right += 1;
    if (c.id) {
      const box = ok ? Math.min((pp.q[c.id] || [0])[0] + (pp.q[c.id] ? 1 : 0), GAPS.length - 1) : 0;
      pp.q[c.id] = [box, addDays(today(), ok ? GAPS[box] : 1)];
      touchDay();
      save(true);
    }
    document.querySelectorAll('[data-qz]').forEach((b) => {
      b.disabled = true;
      const opt = c.options[+b.dataset.qz];
      if (opt === c.answer) b.classList.add('right');
      else if (+b.dataset.qz === k) b.classList.add('wrong');
    });
    const e = W.byId.get(c.iso);
    const after = $('.qz-after');
    after.innerHTML = `<p class="qz-verdict ${ok ? 'ok' : 'no'}">${ok ? 'Right.' : 'Not quite.'} ${esc(c.explain)}</p>
      <p class="qz-next"><button type="button" class="btn" data-qz-next>${round.i + 1 < round.cards.length ? 'Next question' : 'See how you did'}</button>${e ? ` <a href="#${e.id}">Read about ${esc(e.name)}</a>` : ''}</p>`;
    after.hidden = false;
    $('[data-qz-next]').focus();
  }
  function renderEnd() {
    const mastered = Object.values(pp.q).filter((x) => x[0] >= 4).length;
    const next = Object.values(pp.q).map((x) => x[1]).filter((d) => d > today()).sort()[0];
    const n = round.cards.length, r = round.right;
    W.openPanel({ hash: '#quiz', title: 'Quiz', html: `
      ${W.panelTop('Quiz', 'Round finished')}
      <p class="qz-score"><span class="qz-big-n">${r}</span> out of ${n}</p>
      <p class="snapshot">${r === n ? 'A clean sweep.' : r >= n * 0.7 ? 'Solid. The ones you missed will come back tomorrow.' : 'The ones you missed will come back tomorrow, and again until they stick.'}</p>
      <p>${Object.keys(pp.q).length} questions in your rotation; ${mastered} learned for good (right five times in a row, weeks apart).${next ? ` Next review: ${esc(W.fmtDate(next))}.` : ''}</p>
      <p class="qz-next"><button type="button" class="btn" data-qz-again>Another round</button> <a href="#passport">Your passport</a></p>` });
    round = null;
  }
  let quizData = null;
  function loadQuizData() {
    if (!quizData) {
      quizData = Promise.all([
        fetch('data/facts.json').then((r) => r.json()).then((x) => { facts = x; }).catch(() => {}),
        fetch('data/indicators.json').then((r) => r.json()).then((x) => { indicators = x.indicators || []; }).catch(() => {}),
      ]);
    }
    return quizData;
  }

  /* ---------- wiring ---------- */
  let resetArmed = false;
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const q = t.closest('[data-qz]');
    if (q) { answer(+q.dataset.qz); return; }
    if (t.closest('[data-qz-next]')) { round.i += 1; renderQuestion(); return; }
    if (t.closest('[data-qz-again]')) { openQuiz(); return; }
    if (t.closest('[data-pp-lens]')) { if (W.state.mode !== 'politics') W.setMode('politics', { keepPanel: true }); W.setLens('passport'); return; }
    const r = t.closest('[data-pp-reset]');
    if (r) {
      if (!resetArmed) { resetArmed = true; r.textContent = 'Tap again to erase everything'; setTimeout(() => { resetArmed = false; if (r.isConnected) r.textContent = 'Erase it'; }, 4000); return; }
      pp = { v: {}, q: {}, days: [] }; save(true); resetArmed = false; openPassport(); renderToday(); W.refreshPolygons(); W.renderLegend();
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (location.hash !== '#quiz' || !round || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (/^[1-4]$/.test(ev.key) && !round.answered && +ev.key <= round.cards[round.i].options.length) { ev.preventDefault(); answer(+ev.key - 1); }
  });

  W.ext.routes.push((h) => {
    if (h === 'passport') { openPassport(); return true; }
    if (h === 'quiz') { if (!round) openQuiz(); else renderQuestion(); return true; }
    return false;
  });

  W.on('ready', () => {
    renderToday();
    if (W.state.savedLens === 'passport') W.setLens('passport');
    const tools = $('#globe-tools');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tool';
    btn.id = 'pp-btn';
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="1.5" width="10" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="7" r="2.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5.5 11.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span>Passport</span>';
    btn.title = 'Countries you have opened, and a quiz';
    btn.addEventListener('click', () => { location.hash = '#passport'; });
    tools.insertBefore(btn, tools.firstChild);
  });
  W.on('close', renderToday);

  window.WPMPassport = { get data() { return pp; }, buildRound, makeCard, streak, loadQuizData };
})();
