(() => {
'use strict';

const ROUNDS = window.QUIZ_ROUNDS || [];
const CFG = window.FIREBASE_CONFIG;
const FB_VERSION = '10.12.2';
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

/* ================= backends ================= */

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Konnte ' + src + ' nicht laden'));
    document.head.appendChild(s);
  });
}

// Firebase Realtime Database: echte Mehrgeräte-Variante.
async function firebaseBackend(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  await loadScript(base + 'firebase-app-compat.js');
  await loadScript(base + 'firebase-auth-compat.js');
  await loadScript(base + 'firebase-database-compat.js');
  firebase.initializeApp(cfg);
  const db = firebase.database();
  let offset = 0;
  db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
  return {
    kind: 'firebase',
    async init() {
      const auth = firebase.auth();
      const existing = await new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
      if (existing) return existing.uid;
      const cred = await auth.signInAnonymously();
      return cred.user.uid;
    },
    now: () => Date.now() + offset,
    async claim(path, value) { try { await db.ref(path).set(value); return true; } catch (e) { return false; } },
    set: (p, v) => db.ref(p).set(v),
    update: (p, v) => db.ref(p).update(v),
    remove: p => db.ref(p).remove(),
    on(p, cb) {
      const ref = db.ref(p);
      const h = s => cb(s.val());
      ref.on('value', h, err => { console.warn('Lesen verweigert:', p, err && err.message); cb(null); });
      return () => ref.off('value', h);
    },
  };
}

// Demo: alles im localStorage, Tabs desselben Browsers sehen sich gegenseitig.
function localBackend() {
  const KEY = 'kq-demo-db';
  const subs = new Set();
  const read = () => store.get(KEY) || {};
  const get = (t, p) => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), t);
  function put(t, p, v) {
    const ks = p.split('/');
    let o = t;
    for (let i = 0; i < ks.length - 1; i++) {
      if (typeof o[ks[i]] !== 'object' || o[ks[i]] === null) o[ks[i]] = {};
      o = o[ks[i]];
    }
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete o[last]; else o[last] = clone(v);
  }
  function fire() {
    const t = read();
    subs.forEach(s => {
      const v = JSON.stringify(get(t, s.p) ?? null);
      if (v !== s.last) { s.last = v; s.cb(JSON.parse(v)); }
    });
  }
  const write = t => { store.set(KEY, t); fire(); };
  window.addEventListener('storage', e => { if (e.key === KEY) fire(); });
  return {
    kind: 'local',
    async init() {
      let id = null;
      try { id = sessionStorage.getItem('kq-demo-uid'); } catch (e) {}
      if (!id) {
        id = 'u' + Math.random().toString(36).slice(2, 10);
        try { sessionStorage.setItem('kq-demo-uid', id); } catch (e) {}
      }
      return id;
    },
    now: () => Date.now(),
    async claim(p, v) { const t = read(); if (get(t, p) != null) return false; put(t, p, v); write(t); return true; },
    async set(p, v) { const t = read(); put(t, p, v); write(t); },
    async update(p, obj) { const t = read(); for (const k in obj) put(t, p + '/' + k, obj[k]); write(t); },
    async remove(p) { const t = read(); put(t, p, null); write(t); },
    on(p, cb) {
      const s = { p, cb, last: undefined };
      subs.add(s);
      setTimeout(() => { if (!subs.has(s)) return; const v = JSON.stringify(get(read(), p) ?? null); s.last = v; cb(JSON.parse(v)); });
      return () => subs.delete(s);
    },
  };
}

/* ================= state ================= */

const params = new URLSearchParams(location.search);
const urlCode = (params.get('spiel') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

let B = null, me = null;
let mode = 'loading'; // loading | home | setup | host | player | error
let code = null;
let host = store.get('kq-host'); // { code, rounds, timerSec }
let setup = loadSetup();
let G = blankGame();
let subs = [];
let ansSub = null, ansKey = null;
let D = {}; // Entwürfe von Eingabefeldern, überleben ein Neuzeichnen
let ui = { confirmEnd: false, setupErr: '', joinErr: '', answerErr: '', busy: false, error: '' };
let lastTimeUp = null;
let audio = null;

function blankGame() { return { exists: undefined, hostId: null, state: null, teams: {}, marks: {}, answers: {}, myAnswer: null }; }

function loadSetup() {
  const s = store.get('kq-setup');
  if (s && Array.isArray(s.rounds)) return s;
  return {
    timerSec: 60,
    rounds: ROUNDS.map((r, i) => ({
      id: 'r' + i, title: r.title, est: !!r.est, use: true,
      questions: r.questions.map(q => ({ ...q, points: q.points || (r.est ? 2 : 1) })),
    })),
  };
}
const saveSetup = () => store.set('kq-setup', setup);
const saveHost = () => store.set('kq-host', host);
const gpath = p => `games/${code}/${p}`;

/* ================= helpers ================= */

function remaining(s) {
  if (!s || !s.timerSec || s.phase !== 'question') return null;
  if (s.endsAt) return Math.max(0, (s.endsAt - B.now()) / 1000);
  return s.left ?? s.timerSec;
}
const timeUp = s => { const r = remaining(s); return r !== null && r <= 0; };

function teamList() {
  return Object.entries(G.teams || {})
    .filter(([, t]) => t && t.name)
    .map(([id, t]) => ({ id, ...t }))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}
function score(uid, uptoRi = Infinity) {
  let s = 0;
  const joker = G.teams?.[uid]?.joker;
  for (const key in G.marks || {}) {
    const ri = parseInt(key.split('_')[0], 10);
    if (ri > uptoRi) continue;
    const pts = G.marks[key]?.[uid];
    if (pts) s += pts * (joker === ri ? 2 : 1);
  }
  return s;
}
function roundScore(uid, ri) { return score(uid, ri) - score(uid, ri - 1); }
function ranking() {
  const list = teamList().map(t => ({ t, s: score(t.id) })).sort((a, b) => b.s - a.s);
  list.forEach((e, i) => { e.rank = i > 0 && e.s === list[i - 1].s ? list[i - 1].rank : i + 1; });
  return list;
}
const joinUrl = () => location.origin + location.pathname + '?spiel=' + code;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function ensureAudio() {
  try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) {}
}
function bell() {
  if (!audio) return;
  try {
    const t = audio.currentTime;
    [196, 233, 294].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 2.4);
      o.connect(g).connect(audio.destination); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 2.5);
    });
  } catch (e) {}
}
function wakeLock() { try { navigator.wakeLock?.request('screen').catch(() => {}); } catch (e) {} }

/* ================= subscriptions ================= */

function unsubscribeAll() {
  subs.forEach(u => u()); subs = [];
  if (ansSub) { ansSub(); ansSub = null; ansKey = null; }
}
function watch(path, fn) { subs.push(B.on(gpath(path), v => { fn(v); render(); })); }

function startHost(c) {
  unsubscribeAll();
  code = c; mode = 'host'; G = blankGame();
  watch('host', v => {
    G.exists = !!v; G.hostId = v;
    if (v && v !== me) { host = null; saveHost(); mode = 'home'; unsubscribeAll(); }
    if (!v) { host = null; saveHost(); mode = 'home'; unsubscribeAll(); }
  });
  watch('state', v => { G.state = v; });
  watch('teams', v => { G.teams = v || {}; });
  watch('marks', v => { G.marks = v || {}; });
  watch('answers', v => { G.answers = v || {}; });
  wakeLock();
  render();
}

function startPlayer(c) {
  unsubscribeAll();
  code = c; mode = 'player'; G = blankGame();
  watch('host', v => { G.exists = !!v; G.hostId = v; });
  watch('state', v => { G.state = v; });
  watch('teams', v => { G.teams = v || {}; });
  watch('marks', v => { G.marks = v || {}; });
  render();
}

function syncAnswerSub() {
  if (mode !== 'player') return;
  const key = G.state?.key || null;
  if (key === ansKey) return;
  if (ansSub) ansSub();
  ansSub = null; ansKey = key; G.myAnswer = null;
  if (D._answerKey !== key) { D['answer-text'] = ''; D._answerKey = key; ui.answerErr = ''; }
  if (key) ansSub = B.on(gpath(`answers/${key}/${me}`), v => { G.myAnswer = v; render(); });
}

/* ================= host actions ================= */

function makeCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
  return s;
}

async function createGame() {
  const rounds = setup.rounds.filter(r => r.use && r.questions.length);
  if (!rounds.length) return;
  ui.busy = true; ui.setupErr = ''; render();
  let c = null;
  for (let i = 0; i < 8 && !c; i++) { const x = makeCode(); if (await B.claim(`games/${x}/host`, me)) c = x; }
  if (!c) {
    ui.busy = false;
    ui.setupErr = 'Das Spiel konnte nicht angelegt werden. Prüf die Internetverbindung und die Firebase-Einstellungen, dann versuch es noch mal.';
    render(); return;
  }
  code = c;
  host = { code: c, rounds: clone(rounds), timerSec: setup.timerSec };
  saveHost();
  try {
    await B.set(gpath('createdAt'), B.now());
    await B.set(gpath('state'), { phase: 'lobby', ri: 0, qi: 0, total: rounds.length, timerSec: setup.timerSec, revealed: false });
  } catch (e) { console.warn(e); }
  ui.busy = false;
  startHost(c);
}

const setState = patch => B.update(gpath('state'), patch).catch(e => console.warn(e));

function goIntro(ri) {
  const r = host.rounds[ri];
  setState({
    phase: 'intro', ri, qi: 0, key: null, revealed: false, q: null, answer: null, note: null, endsAt: null, left: null,
    roundTitle: r.title, roundEst: !!r.est, roundCount: r.questions.length, total: host.rounds.length,
  });
}
function goQuestion(qi) {
  const s = G.state, r = host.rounds[s.ri], q = r.questions[qi];
  const T = host.timerSec || 0;
  setState({
    phase: 'question', qi, key: `${s.ri}_${qi}`, revealed: false,
    q: { text: q.q, points: q.points || 1, n: qi + 1 },
    answer: null, note: null,
    endsAt: T ? B.now() + T * 1000 : null, left: T || null, timerSec: T,
  });
}
function reveal() {
  const s = G.state, q = host.rounds[s.ri].questions[s.qi];
  setState({ revealed: true, answer: q.a, note: q.note || null, endsAt: null, left: 0 });
}
function primaryHost() {
  const s = G.state;
  if (!s || !host) return;
  if (s.phase === 'lobby') { if (teamList().length) goIntro(0); }
  else if (s.phase === 'intro') goQuestion(0);
  else if (s.phase === 'question') {
    if (!s.revealed) reveal();
    else if (s.qi < host.rounds[s.ri].questions.length - 1) goQuestion(s.qi + 1);
    else setState({ phase: 'standings', endsAt: null });
  }
  else if (s.phase === 'standings') {
    if (s.ri < host.rounds.length - 1) goIntro(s.ri + 1);
    else setState({ phase: 'end' });
  }
  window.scrollTo(0, 0);
}
function hostTimerToggle() {
  const s = G.state;
  if (!s || s.phase !== 'question' || s.revealed || !s.timerSec) return;
  const rem = remaining(s);
  if (s.endsAt) setState({ endsAt: null, left: rem });
  else setState({ endsAt: B.now() + (rem > 0 ? rem : s.timerSec) * 1000, left: null });
}
function toggleMark(uid) {
  const s = G.state;
  if (!s || !s.key || !s.revealed) return;
  const pts = s.q?.points || 1;
  const cur = G.marks?.[s.key]?.[uid];
  if (s.roundEst) B.set(gpath(`marks/${s.key}`), cur ? null : { [uid]: pts });
  else B.set(gpath(`marks/${s.key}/${uid}`), cur ? null : pts);
}
function endGame() {
  if (G.state && G.state.phase !== 'end') setState({ phase: 'end' });
  host = null; saveHost(); unsubscribeAll();
  ui.confirmEnd = false; mode = 'home'; code = null;
  history.replaceState(null, '', location.pathname);
  render();
}

/* ================= player actions ================= */

async function joinTeam() {
  const name = (D['team-name'] || '').trim().slice(0, 40);
  if (!name) { ui.joinErr = 'Gebt eurem Team einen Namen.'; render(); return; }
  const taken = teamList().some(t => t.id !== me && t.name.toLowerCase() === name.toLowerCase());
  if (taken) { ui.joinErr = 'Den Namen hat schon ein anderes Team. Nehmt einen anderen.'; render(); return; }
  ui.joinErr = '';
  try { await B.set(gpath(`teams/${me}`), { name, joker: null, at: B.now() }); wakeLock(); }
  catch (e) { ui.joinErr = 'Beitreten hat nicht geklappt. Prüf die Verbindung und versuch es noch mal.'; render(); }
}
async function sendAnswer() {
  const s = G.state;
  const text = (D['answer-text'] || '').trim().slice(0, 200);
  if (!s || !s.key || s.revealed || !text) return;
  if (timeUp(s)) { ui.answerErr = 'Die Zeit ist abgelaufen.'; render(); return; }
  ui.answerErr = '';
  try { await B.set(gpath(`answers/${s.key}/${me}`), { text, at: B.now() }); }
  catch (e) { ui.answerErr = 'Zu spät, die Frage ist schon aufgelöst.'; render(); }
}
function toggleJoker() {
  const s = G.state, t = G.teams?.[me];
  if (!s || s.phase !== 'intro' || !t) return;
  if (t.joker != null && t.joker !== s.ri) return;
  B.update(gpath(`teams/${me}`), { joker: t.joker === s.ri ? null : s.ri });
}

/* ================= views: shared pieces ================= */

function candle(big) {
  return `<div class="candle ${big ? 'big' : ''}" data-act="${big ? 'timer' : ''}" ${big ? 'role="button" tabindex="0" aria-label="Timer starten oder pausieren"' : ''}>
    <svg viewBox="0 0 80 170" aria-hidden="true">
      <g data-flame class="flame-wrap">
        <ellipse class="glow" cx="40" cy="22" rx="22" ry="24" fill="var(--pumpkin)" opacity=".18"/>
        <path class="flame" d="M40 4 C50 18 52 28 40 38 C28 28 30 18 40 4 Z" fill="var(--pumpkin)"/>
        <path class="flame inner" d="M40 18 C45 25 45 31 40 36 C35 31 35 25 40 18 Z" fill="var(--candle-core)"/>
      </g>
      <line data-wick x1="40" y1="34" x2="40" y2="42" stroke="var(--ink-soft)" stroke-width="2"/>
      <rect data-wax x="24" y="42" width="32" height="116" rx="3" fill="var(--bone)"/>
      <path data-drip d="M24 42 h10 v14 a3 3 0 0 1 -6 0 v-6 a2 2 0 0 0 -4 0 Z" fill="var(--bone-shade)"/>
      <ellipse cx="40" cy="160" rx="34" ry="7" fill="var(--night-3)" stroke="var(--line-strong)"/>
    </svg>
    <div class="t-num" data-tnum></div>
    ${big ? '<div class="t-label" data-tlabel></div>' : ''}
  </div>`;
}

function paintTimers() {
  const s = G.state;
  const rem = remaining(s);
  document.querySelectorAll('.candle').forEach(el => {
    if (rem === null) { el.hidden = true; return; }
    el.hidden = false;
    const frac = s.timerSec ? Math.max(0, Math.min(1, rem / s.timerSec)) : 0;
    const top = 150 - frac * 108;
    const svg = el.querySelector('svg');
    svg.querySelector('[data-wax]').setAttribute('y', top);
    svg.querySelector('[data-wax]').setAttribute('height', 158 - top);
    svg.querySelector('[data-drip]').setAttribute('transform', `translate(0 ${top - 42})`);
    const wick = svg.querySelector('[data-wick]');
    wick.setAttribute('y1', top - 8); wick.setAttribute('y2', top);
    const flame = svg.querySelector('[data-flame]');
    flame.setAttribute('transform', `translate(0 ${top - 42})`);
    flame.style.display = rem > 0 ? '' : 'none';
    el.classList.toggle('paused', !s.endsAt && rem > 0);
    const n = el.querySelector('[data-tnum]');
    n.textContent = rem > 0 ? Math.ceil(rem) : 'Aus!';
    n.classList.toggle('low', rem > 0 && rem <= 10 && !!s.endsAt);
    const l = el.querySelector('[data-tlabel]');
    if (l) l.textContent = rem <= 0 ? 'Kerze ist aus' : s.endsAt ? 'Antippen: Pause' : 'Antippen: weiter';
  });
}

function topbar() {
  const demo = B && B.kind === 'local'
    ? `<div class="demo">Demo-Modus: Mitspielen geht nur in weiteren Tabs dieses Browsers. Für Handys Firebase einrichten (ANLEITUNG.md).</div>` : '';
  let right = '';
  if (mode === 'host') {
    right = `<span class="code-chip">Code <b>${esc(code)}</b></span>
      <button class="btn small" data-act="fullscreen">Vollbild</button>
      ${ui.confirmEnd
        ? `<span class="confirm">Spiel beenden? <button class="btn small danger" data-act="end-yes">Ja, beenden</button><button class="btn small" data-act="end-no">Nein</button></span>`
        : `<button class="btn small" data-act="end">Spiel beenden</button>`}`;
  } else if (mode === 'player' && G.teams?.[me]) {
    right = `<span class="code-chip">${esc(G.teams[me].name)} · <b>${score(me)}</b> Pkt.</span>`;
  }
  return `${demo}<header class="bar"><a class="brand" href="${esc(location.pathname)}" data-act="home-link">${pumpkinMark()}<span>Kneipen<em>quiz</em></span></a><div class="bar-tools">${right}</div></header>`;
}
function pumpkinMark() {
  return `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 10c2-5 7-7 10-6-4 2-6 5-6 9" fill="none" stroke="var(--slime)" stroke-width="4" stroke-linecap="round"/><ellipse cx="20" cy="38" rx="14" ry="20" fill="var(--pumpkin-deep)"/><ellipse cx="44" cy="38" rx="14" ry="20" fill="var(--pumpkin-deep)"/><ellipse cx="32" cy="38" rx="16" ry="22" fill="var(--pumpkin)"/><path d="M21 32l6-6 3 8zM43 32l-6-6-3 8z" fill="var(--night)"/><path d="M20 44c6 6 18 6 24 0l-4 1-2 3-3-3-3 3-3-3-2 3-3-3z" fill="var(--night)"/></svg>`;
}

function stones(list, ri, final) {
  return `<div class="stones">${list.map((e, i) => {
    const d = ri != null ? roundScore(e.t.id, ri) : 0;
    const isMe = e.t.id === me;
    return `<div class="stone ${e.rank === 1 && e.s > 0 ? 'first' : ''} ${isMe ? 'me' : ''}" style="--tilt:${((i * 37) % 7) - 3}deg">
      <span class="rip">${e.rank}. Platz</span>
      <span class="nm">${esc(e.t.name)}</span>
      <span class="pts">${e.s}<small>${e.s === 1 ? 'Punkt' : 'Punkte'}</small></span>
      ${!final && ri != null ? `<span class="delta">+${d} diese Runde${e.t.joker === ri ? ' · Joker' : ''}</span>` : ''}
      ${isMe && mode === 'player' ? '<span class="you">Ihr</span>' : ''}
    </div>`;
  }).join('')}</div>`;
}

/* ================= views: home & setup ================= */

function viewHome() {
  const resume = host?.code
    ? `<div class="resume"><span>Dein Spiel <b>${esc(host.code)}</b> läuft noch.</span><button class="btn" data-act="resume">Weiterleiten</button><button class="btn ghost small" data-act="forget">Verwerfen</button></div>` : '';
  return `<section class="home">
    <div class="home-hero">
      <span class="eyebrow">Halloween-Ausgabe</span>
      <h1>Wer weiß,<br>was hier <em>spukt</em>?</h1>
      <p>Ein Bildschirm für alle, ein Handy pro Team. Fragen erscheinen groß an der Wand, die Teams tippen ihre Antworten aufs Handy.</p>
    </div>
    ${resume}
    <div class="home-grid">
      <div class="card">
        <h2>Quiz leiten</h2>
        <p>Runden aussuchen, Spiel eröffnen, Code an die Wand werfen.</p>
        <button class="btn primary" data-act="to-setup">Neues Quiz eröffnen</button>
      </div>
      <form class="card" data-form="join-code">
        <h2>Mitspielen</h2>
        <label for="join-code">Spielcode von der Leinwand</label>
        <div class="row">
          <input class="field code-input" id="join-code" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="z. B. KRPX" value="${esc(D['join-code'] || '')}">
          <button class="btn primary" type="submit">Los</button>
        </div>
      </form>
    </div>
  </section>`;
}

function viewSetup() {
  const rounds = setup.rounds.map(r => `
    <label class="round-item">
      <input type="checkbox" id="round-${r.id}" data-round="${r.id}" ${r.use ? 'checked' : ''}>
      <span class="t">${esc(r.title)}${r.est ? ' <span class="tag">Schätzen</span>' : ''}</span>
      <span class="m">${plural(r.questions.length, 'Frage', 'Fragen')}</span>
      ${r.custom ? `<button class="icon-btn" type="button" data-act="del-round" data-id="${r.id}" aria-label="Runde löschen" title="Runde löschen">×</button>` : ''}
    </label>`).join('');
  const sel = setup.rounds.filter(r => r.use);
  const nQ = sel.reduce((s, r) => s + r.questions.length, 0);
  return `<section class="setup">
    <div class="section-head"><span class="eyebrow">Neues Quiz</span><h1>Runden aussuchen</h1></div>
    <div class="setup-grid">
      <div class="panel">
        <div class="round-list">${rounds}</div>
        <button class="btn ghost small" data-act="reset-rounds">Standardfragen wiederherstellen</button>
      </div>
      <div class="panel">
        <details ${ui.setupErr && ui.setupErr.startsWith('Zeile') || ui.setupErr.startsWith('Keine') ? 'open' : ''}>
          <summary>Eigene Runde schreiben</summary>
          <p class="hint">Eine Frage pro Zeile: <code>Frage | Antwort</code>. Mit Punkten: <code>Frage | Antwort | 2</code></p>
          <div class="stack">
            <input class="field" id="custom-title" placeholder="Name der Runde" value="${esc(D['custom-title'] || '')}">
            <textarea class="field" id="custom-text" placeholder="Was trinkt der Wirt am liebsten? | Pils&#10;Wie heißt die Katze vom Tresen? | Mephisto">${esc(D['custom-text'] || '')}</textarea>
            <div><button class="btn" data-act="add-round">Runde hinzufügen</button></div>
          </div>
        </details>
        <div class="row">
          <label for="timer-sel">Zeit pro Frage</label>
          <select class="field" id="timer-sel">
            ${[0, 30, 45, 60, 90, 120].map(s => `<option value="${s}" ${setup.timerSec === s ? 'selected' : ''}>${s ? s + ' Sekunden' : 'Kein Timer'}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    ${ui.setupErr ? `<p class="err">${esc(ui.setupErr)}</p>` : ''}
    <div class="action-row">
      <button class="btn ghost" data-act="home">Zurück</button>
      <button class="btn primary" data-act="create" ${nQ && !ui.busy ? '' : 'disabled'}>${ui.busy ? 'Wird eröffnet …' : 'Spiel eröffnen'}</button>
      <span class="meta">${plural(sel.length, 'Runde', 'Runden')} · ${plural(nQ, 'Frage', 'Fragen')}</span>
    </div>
  </section>`;
}

function addCustomRound() {
  const title = (D['custom-title'] || '').trim();
  const lines = (D['custom-text'] || '').split('\n').map(l => l.trim()).filter(Boolean);
  const qs = [], bad = [];
  lines.forEach((l, i) => {
    const [q, a, p] = l.split('|').map(x => x.trim());
    if (q && a) qs.push({ q, a, points: Math.max(1, parseInt(p, 10) || 1) });
    else bad.push(i + 1);
  });
  if (!qs.length) ui.setupErr = 'Keine Frage erkannt. Schreib jede Frage in eine eigene Zeile, mit | zwischen Frage und Antwort.';
  else if (bad.length) ui.setupErr = `Zeile ${bad.join(', ')} hat keine Antwort. Trenn Frage und Antwort mit |.`;
  else {
    ui.setupErr = '';
    setup.rounds.push({ id: 'c' + Date.now().toString(36), title: title || 'Eigene Runde', custom: true, use: true, questions: qs });
    D['custom-title'] = ''; D['custom-text'] = '';
    saveSetup();
  }
  render();
}

/* ================= views: host ================= */

function viewHost() {
  const s = G.state;
  if (!s) return `<p class="muted center">Verbinde …</p>`;
  if (s.phase === 'lobby') return hostLobby();
  if (s.phase === 'intro') return hostIntro(s);
  if (s.phase === 'question') return hostQuestion(s);
  return hostStandings(s, s.phase === 'end');
}

function hostLobby() {
  const teams = teamList();
  return `<section class="lobby">
    <div class="join-box">
      <span class="eyebrow">Mitspielen mit dem Handy</span>
      <div class="qr" id="qr" aria-label="QR-Code zum Beitreten"></div>
      <div class="join-url">${esc(joinUrl())}</div>
    </div>
    <div class="lobby-side">
      <span class="eyebrow">Spielcode</span>
      <div class="big-code">${esc(code)}</div>
      <h2>${teams.length ? plural(teams.length, 'Team ist da', 'Teams sind da') : 'Noch keine Teams'}</h2>
      <ul class="team-list">${teams.map(t => `<li><span>${esc(t.name)}</span><button class="icon-btn" data-act="kick" data-id="${esc(t.id)}" aria-label="Team entfernen" title="Team entfernen">×</button></li>`).join('') || '<li class="muted">QR-Code scannen oder den Code auf der Startseite eingeben.</li>'}</ul>
      <div class="action-row">
        <button class="btn primary" data-act="primary" ${teams.length ? '' : 'disabled'}>Quiz starten</button>
        <span class="kbd"><b>Leertaste</b> weiter</span>
      </div>
    </div>
  </section>`;
}

function hostIntro(s) {
  const teams = teamList();
  const jokers = teams.filter(t => t.joker === s.ri);
  return `<section class="intro">
    <span class="eyebrow">Runde ${s.ri + 1} von ${s.total}</span>
    <h1 class="round-title">${esc(s.roundTitle)}</h1>
    <p>${plural(s.roundCount, 'Frage', 'Fragen')}. ${s.roundEst ? 'Die Schätzung, die am nächsten dran ist, bekommt die Punkte.' : 'Jede richtige Antwort gibt Punkte.'}
      Jedes Team kann jetzt auf dem Handy seinen Joker setzen, dann zählt diese Runde doppelt. Der Joker geht nur einmal pro Spiel.</p>
    <div class="joker-row">${jokers.length ? jokers.map(t => `<span class="pill hot">${esc(t.name)} setzt den Joker</span>`).join('') : '<span class="muted">Noch hat niemand seinen Joker gesetzt.</span>'}</div>
    <div class="action-row">
      <button class="btn primary" data-act="primary">Erste Frage</button>
      <span class="kbd"><b>Leertaste</b> weiter</span>
    </div>
  </section>`;
}

function hostQuestion(s) {
  const teams = teamList();
  const answers = G.answers?.[s.key] || {};
  const marks = G.marks?.[s.key] || {};
  const nAns = teams.filter(t => answers[t.id]).length;
  const lastQ = s.qi >= s.roundCount - 1;
  const body = !s.revealed
    ? `<div class="answered">
        <span class="meta">${nAns} von ${teams.length} Teams haben geantwortet</span>
        <div class="pills">${teams.map(t => `<span class="pill ${answers[t.id] ? 'done' : ''}">${esc(t.name)}</span>`).join('')}</div>
      </div>`
    : `<div class="answer">
        <span class="label">Richtige Antwort</span>
        <span class="text">${esc(s.answer)}</span>
        ${s.note ? `<span class="note">${esc(s.note)}</span>` : ''}
      </div>
      <p class="meta">${s.roundEst ? 'Wer lag am nächsten dran? Ein Team antippen.' : 'Richtige Antworten antippen, um Punkte zu vergeben.'}</p>
      <div class="ans-list">${teams.map((t, i) => {
        const a = answers[t.id];
        const on = !!marks[t.id];
        return `<button class="ans ${on ? 'on' : ''}" data-act="mark" data-id="${esc(t.id)}" aria-pressed="${on}">
          <span class="tick">${on ? '✓' : ''}</span>
          <span class="who">${esc(t.name)}${i < 9 ? ` <span class="k">${i + 1}</span>` : ''}</span>
          <span class="what">${a ? esc(a.text) : '<i>keine Antwort</i>'}</span>
        </button>`;
      }).join('')}</div>`;
  return `<section class="q-wrap">
    <div class="q-main">
      <div class="q-meta">
        <span class="eyebrow">${esc(s.roundTitle)} · Frage ${s.qi + 1} von ${s.roundCount}</span>
        ${s.roundEst ? '<span class="tag solid">Schätzfrage</span>' : ''}
        ${(s.q?.points || 1) > 1 ? `<span class="tag">${s.q.points} Punkte</span>` : ''}
      </div>
      <h1 class="question">${esc(s.q?.text)}</h1>
      ${body}
      <div class="action-row">
        <button class="btn primary" data-act="primary">${!s.revealed ? 'Antwort zeigen' : lastQ ? 'Zwischenstand' : 'Nächste Frage'}</button>
        <span class="kbd"><b>Leertaste</b> weiter · <b>T</b> Timer${s.revealed ? ' · <b>1–9</b> Punkte' : ''}</span>
      </div>
    </div>
    <aside class="q-side">${s.timerSec && !s.revealed ? candle(true) : ''}</aside>
  </section>`;
}

function hostStandings(s, final) {
  const list = ranking();
  const winners = list.filter(e => e.rank === 1 && e.s > 0).map(e => esc(e.t.name));
  const last = s.ri >= s.total - 1;
  return `<section>
    <div class="section-head">
      <span class="eyebrow">${final ? 'Endstand' : `Zwischenstand nach Runde ${s.ri + 1} von ${s.total}`}</span>
      <h1>${final ? (winners.length ? `${winners.join(' & ')} ${winners.length > 1 ? 'gewinnen' : 'gewinnt'}!` : 'Das Quiz ist vorbei') : winners.length ? `${winners.join(' & ')} ${winners.length > 1 ? 'führen' : 'führt'}` : 'Noch alles offen'}</h1>
    </div>
    ${stones(list, final ? null : s.ri, final)}
    <div class="action-row">
      ${final ? '<button class="btn primary" data-act="end-yes">Neues Quiz</button>'
        : `<button class="btn primary" data-act="primary">${last ? 'Zur Siegerehrung' : 'Nächste Runde'}</button><span class="kbd"><b>Leertaste</b> weiter</span>`}
    </div>
  </section>`;
}

/* ================= views: player ================= */

function viewPlayer() {
  if (G.exists === undefined) return `<p class="muted center">Verbinde mit Spiel ${esc(code)} …</p>`;
  if (G.exists === false) return `<section class="p-card">
    <h1>Kein Spiel mit dem Code ${esc(code)}</h1>
    <p>Prüft den Code auf der Leinwand. Groß- und Kleinschreibung ist egal.</p>
    <button class="btn primary" data-act="home">Anderen Code eingeben</button></section>`;
  const s = G.state || {};
  const myTeam = G.teams?.[me];
  if (!myTeam) {
    if (s.phase === 'end') return `<section class="p-card"><h1>Dieses Quiz ist schon vorbei</h1><button class="btn primary" data-act="home">Zur Startseite</button></section>`;
    return `<form class="p-card" data-form="join-team">
      <span class="eyebrow">Spiel ${esc(code)}</span>
      <h1>Wie heißt euer Team?</h1>
      <input class="field" id="team-name" maxlength="40" autocomplete="off" placeholder="z. B. Die Untoten vom Tresen" value="${esc(D['team-name'] || '')}">
      ${ui.joinErr ? `<p class="err">${esc(ui.joinErr)}</p>` : ''}
      <button class="btn primary" type="submit">Beitreten</button>
      <p class="muted small">Ein Handy pro Team reicht. Ihr könnt jederzeit einsteigen.</p>
    </form>`;
  }
  if (s.phase === 'lobby') return `<section class="p-card">
    <span class="eyebrow">Ihr seid drin</span>
    <h1>${esc(myTeam.name)}</h1>
    <p>Gleich geht’s los. Schaut auf die Leinwand.</p>
    <ul class="team-list">${teamList().map(t => `<li class="${t.id === me ? 'mine' : ''}">${esc(t.name)}</li>`).join('')}</ul>
  </section>`;
  if (s.phase === 'intro') {
    const j = myTeam.joker;
    const here = j === s.ri, used = j != null && !here;
    return `<section class="p-card">
      <span class="eyebrow">Runde ${s.ri + 1} von ${s.total}</span>
      <h1>${esc(s.roundTitle)}</h1>
      <p>${s.roundEst ? 'Schätzrunde: Die nächste Schätzung gewinnt.' : plural(s.roundCount, 'Frage', 'Fragen') + '.'}</p>
      <button class="joker ${here ? 'on' : ''}" data-act="joker" ${used ? 'disabled' : ''} aria-pressed="${here}">
        <span class="j-title">${here ? 'Joker gesetzt' : used ? 'Joker schon verbraucht' : 'Joker setzen'}</span>
        <span class="j-sub">${here ? 'Diese Runde zählt doppelt. Antippen zum Zurücknehmen.' : used ? `Ihr habt ihn in Runde ${j + 1} gesetzt.` : 'Punkte dieser Runde zählen doppelt. Geht nur einmal im Spiel.'}</span>
      </button>
    </section>`;
  }
  if (s.phase === 'question') {
    const mine = G.myAnswer;
    const marked = G.marks?.[s.key]?.[me];
    if (s.revealed) {
      return `<section class="p-card">
        <span class="eyebrow">Frage ${s.qi + 1} von ${s.roundCount}</span>
        <p class="p-q">${esc(s.q?.text)}</p>
        <div class="answer small"><span class="label">Richtige Antwort</span><span class="text">${esc(s.answer)}</span>${s.note ? `<span class="note">${esc(s.note)}</span>` : ''}</div>
        <p>Eure Antwort: <b>${mine ? esc(mine.text) : 'keine'}</b></p>
        <div class="verdict ${marked ? 'good' : ''}">${marked ? `Punkt! +${marked * (myTeam.joker === s.ri ? 2 : 1)}` : 'Der Quizmaster wertet aus …'}</div>
      </section>`;
    }
    const up = timeUp(s);
    return `<section class="p-card">
      <div class="p-head">
        <span class="eyebrow">${esc(s.roundTitle)} · Frage ${s.qi + 1}/${s.roundCount}</span>
        ${s.timerSec ? candle(false) : ''}
      </div>
      <p class="p-q">${esc(s.q?.text)}</p>
      ${up ? `<div class="verdict">${mine ? `Zeit um. Eure Antwort: „${esc(mine.text)}“` : 'Zeit um. Keine Antwort abgegeben.'}</div>` : `
      <form class="stack" data-form="answer">
        <label for="answer-text">${s.roundEst ? 'Eure Schätzung' : 'Eure Antwort'}</label>
        <input class="field" id="answer-text" maxlength="200" autocomplete="off" ${s.roundEst ? 'inputmode="decimal"' : ''} value="${esc(D['answer-text'] || '')}">
        <button class="btn primary" type="submit">${mine ? 'Antwort ändern' : 'Antwort abschicken'}</button>
        ${mine ? `<p class="sent">Abgeschickt: „${esc(mine.text)}“</p>` : ''}
        ${ui.answerErr ? `<p class="err">${esc(ui.answerErr)}</p>` : ''}
      </form>`}
    </section>`;
  }
  const list = ranking();
  const mineE = list.find(e => e.t.id === me);
  return `<section class="p-card">
    <span class="eyebrow">${s.phase === 'end' ? 'Endstand' : `Nach Runde ${s.ri + 1} von ${s.total}`}</span>
    <h1>${mineE ? `${mineE.rank}. Platz mit ${plural(mineE.s, 'Punkt', 'Punkten')}` : ''}</h1>
    <ol class="rank-list">${list.map(e => `<li class="${e.t.id === me ? 'mine' : ''}"><span class="r">${e.rank}.</span><span class="n">${esc(e.t.name)}</span><span class="s">${e.s}</span></li>`).join('')}</ol>
    ${s.phase === 'end' ? '<button class="btn" data-act="home">Zur Startseite</button>' : ''}
  </section>`;
}

/* ================= render ================= */

function render() {
  const a = document.activeElement;
  const focus = a && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  syncAnswerSub();
  let body = '';
  if (mode === 'loading') body = `<p class="muted center">Lade …</p>`;
  else if (mode === 'error') body = `<section class="p-card"><h1>Keine Verbindung</h1><p>${esc(ui.error)}</p><button class="btn primary" data-act="reload">Neu laden</button></section>`;
  else if (mode === 'home') body = viewHome();
  else if (mode === 'setup') body = viewSetup();
  else if (mode === 'host') body = viewHost();
  else if (mode === 'player') body = viewPlayer();
  app.className = 'app mode-' + mode;
  app.innerHTML = topbar() + `<main>${body}</main>`;
  if (focus) {
    const el = document.getElementById(focus.id);
    if (el) { el.focus({ preventScroll: true }); try { if (focus.s != null) el.setSelectionRange(focus.s, focus.e); } catch (e) {} }
  }
  const qr = document.getElementById('qr');
  if (qr && window.QRCode) {
    try { new QRCode(qr, { text: joinUrl(), width: 240, height: 240, colorDark: '#14101c', colorLight: '#efe6d6', correctLevel: QRCode.CorrectLevel.M }); } catch (e) {}
  }
  lastTimeUp = timeUp(G.state);
  paintTimers();
}

setInterval(() => {
  if (!G.state || G.state.phase !== 'question') return;
  paintTimers();
  const up = timeUp(G.state);
  if (up !== lastTimeUp) {
    if (up && mode === 'host' && !G.state.revealed) bell();
    if (mode === 'player') render(); else lastTimeUp = up;
  }
}, 200);

/* ================= events ================= */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !el.dataset.act) return;
  ensureAudio();
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'home-link': e.preventDefault(); if (mode !== 'host') goHome(); break;
    case 'home': goHome(); break;
    case 'to-setup': mode = 'setup'; ui.setupErr = ''; render(); break;
    case 'resume': startHost(host.code); break;
    case 'forget': host = null; saveHost(); render(); break;
    case 'create': createGame(); break;
    case 'add-round': addCustomRound(); break;
    case 'del-round': e.preventDefault(); setup.rounds = setup.rounds.filter(r => r.id !== id); saveSetup(); render(); break;
    case 'reset-rounds': { const custom = setup.rounds.filter(r => r.custom); store.set('kq-setup', null); setup = loadSetup(); setup.rounds.push(...custom); saveSetup(); render(); break; }
    case 'primary': primaryHost(); break;
    case 'timer': if (mode === 'host') hostTimerToggle(); break;
    case 'mark': toggleMark(id); break;
    case 'kick': B.remove(gpath(`teams/${id}`)); break;
    case 'end': ui.confirmEnd = true; render(); break;
    case 'end-no': ui.confirmEnd = false; render(); break;
    case 'end-yes': endGame(); break;
    case 'joker': toggleJoker(); break;
    case 'reload': location.reload(); break;
    case 'fullscreen':
      try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}); } catch (err) {}
      break;
  }
});

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  ensureAudio();
  if (f.dataset.form === 'join-code') {
    const c = (D['join-code'] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!c) return;
    history.replaceState(null, '', location.pathname + '?spiel=' + c);
    startPlayer(c);
  }
  if (f.dataset.form === 'join-team') joinTeam();
  if (f.dataset.form === 'answer') sendAnswer();
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id) D[t.id] = t.value;
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.round) { const r = setup.rounds.find(x => x.id === t.dataset.round); if (r) { r.use = t.checked; saveSetup(); render(); } }
  if (t.id === 'timer-sel') { setup.timerSec = parseInt(t.value, 10) || 0; saveSetup(); }
});

document.addEventListener('keydown', e => {
  if (mode !== 'host') return;
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' || e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest('button, [role=button]'))) {
    e.preventDefault(); ensureAudio(); primaryHost();
  } else if (e.key === 'Enter' && e.target.closest('[role=button]')) {
    e.preventDefault(); hostTimerToggle();
  } else if (e.key.toLowerCase() === 't') { ensureAudio(); hostTimerToggle(); }
  else if (/^[1-9]$/.test(e.key) && G.state?.revealed) {
    const t = teamList()[parseInt(e.key, 10) - 1];
    if (t) toggleMark(t.id);
  }
});

function goHome() {
  unsubscribeAll();
  if (mode === 'player') history.replaceState(null, '', location.pathname);
  mode = 'home'; code = null; G = blankGame();
  render();
}

/* ================= boot ================= */

async function boot() {
  render();
  try {
    B = CFG ? await firebaseBackend(CFG) : localBackend();
    me = await B.init();
  } catch (e) {
    console.error(e);
    mode = 'error';
    ui.error = CFG
      ? 'Die Verbindung zu Firebase hat nicht geklappt. Prüf die Daten in config.js und ob die anonyme Anmeldung in Firebase eingeschaltet ist.'
      : 'Die App konnte nicht starten.';
    render(); return;
  }
  if (urlCode) startPlayer(urlCode);
  else if (host?.code) startHost(host.code);
  else { mode = 'home'; render(); }
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
})();
