// ═══════════════════════════════════════════════
// app.js — Lexis v2
// ═══════════════════════════════════════════════

// ── State ────────────────────────────────────
let currentUser = null;
let words = [];
let wordFilter = 'all';
let direction = 'en'; // 'en' = EN→RU, 'ru' = RU→EN
let sessionMode = null;
let sessionWords = [];
let sessionIndex = 0;
let sessionScore = 0;
let sessionMistakes = [];
let fcRevealed = false;
let chAnswered = false;
let matchState = {};
let matchTimer = null;
let matchSeconds = 0;
let dailyDone = 0;
const SESSION_SIZE = 10;

// ── Telegram ─────────────────────────────────
window.Telegram?.WebApp?.ready();
window.Telegram?.WebApp?.expand();

;(async function tryTgAuth() {
  const tg = window.Telegram?.WebApp;
  if (tg?.initDataUnsafe?.user?.username) {
    const name = tg.initDataUnsafe.user.username;
    try {
      let u = await dbGetUser(name);
      if (!u) u = await dbCreateUser(name, await hashPass(name + '_tg'));
      if (u) await loginSuccess(u);
    } catch (e) {}
  }
})();

// ── AUTH ──────────────────────────────────────
async function authLogin() {
  const name = document.getElementById('auth-name').value.trim();
  const pass = document.getElementById('auth-pass').value.trim();
  const err  = document.getElementById('auth-error');
  err.textContent = '';
  if (!name || !pass) { err.textContent = 'заполни все поля'; return; }
  if (pass.length < 4) { err.textContent = 'пароль минимум 4 символа'; return; }
  const btn = document.getElementById('auth-btn');
  btn.textContent = 'загрузка...'; btn.disabled = true;
  try {
    const ph = await hashPass(pass);
    let u = await dbGetUser(name);
    if (!u) {
      u = await dbCreateUser(name, ph);
    } else if (u.pass_hash !== ph) {
      err.textContent = 'неверный пароль';
      btn.textContent = 'войти / создать аккаунт'; btn.disabled = false;
      return;
    }
    await loginSuccess(u);
  } catch(e) {
    err.textContent = 'ошибка: ' + e.message;
    btn.textContent = 'войти / создать аккаунт'; btn.disabled = false;
  }
}

async function loginSuccess(user) {
  currentUser = user;
  localStorage.setItem('lexis_user', JSON.stringify(user));
  document.getElementById('header-username').textContent = user.name;
  document.getElementById('screen-auth').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  await loadWords();
  updateStreak();
}

function logout() {
  currentUser = null; words = []; dailyDone = 0;
  localStorage.removeItem('lexis_user');
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-auth').classList.add('active');
  document.getElementById('auth-name').value = '';
  document.getElementById('auth-pass').value = '';
}

;(async function autoLogin() {
  const saved = localStorage.getItem('lexis_user');
  if (!saved) return;
  try {
    const u = JSON.parse(saved);
    const fresh = await dbGetUser(u.name);
    if (fresh && fresh.pass_hash === u.pass_hash) await loginSuccess(fresh);
    else localStorage.removeItem('lexis_user');
  } catch(e) { localStorage.removeItem('lexis_user'); }
})();

document.getElementById('auth-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') authLogin();
});

// ── STREAK ───────────────────────────────────
function updateStreak() {
  if (!currentUser) return;
  const s = calcStreak(currentUser);
  document.getElementById('streak-count').textContent = s.streak;
  // save if changed
  if (s.last_practice !== currentUser.last_practice) {
    currentUser.streak = s.streak;
    currentUser.last_practice = s.last_practice;
    dbUpdateUser(currentUser.id, { streak: s.streak, last_practice: s.last_practice });
    localStorage.setItem('lexis_user', JSON.stringify(currentUser));
  }
}

// ── WORDS ─────────────────────────────────────
async function loadWords() {
  document.getElementById('wlist').innerHTML = '<div class="loading">загрузка...</div>';
  try {
    words = await dbGetWords(currentUser.id) || [];
    renderDashboard();
    renderWordList();
  } catch(e) {
    document.getElementById('wlist').innerHTML = '<div class="empty">ошибка загрузки</div>';
  }
}

async function addWord() {
  const en = document.getElementById('inp-en').value.trim();
  const ru = document.getElementById('inp-ru').value.trim();
  const tr = document.getElementById('inp-tr').value.trim();
  if (!en || !ru) return;
  try {
    const w = await dbAddWord(currentUser.id, en, ru, tr);
    if (w) { words.push(w); renderDashboard(); renderWordList(); }
    document.getElementById('inp-en').value = '';
    document.getElementById('inp-ru').value = '';
    document.getElementById('inp-tr').value = '';
    document.getElementById('inp-en').focus();
  } catch(e) { alert('ошибка: ' + e.message); }
}

async function importWords() {
  const raw = document.getElementById('inp-import').value.trim();
  if (!raw) return;
  const lines = raw.split('\n').filter(l => l.includes('—') || l.includes('-') || l.includes('\t'));
  let added = 0;
  for (const line of lines) {
    const sep = line.includes('—') ? '—' : line.includes('\t') ? '\t' : '-';
    const parts = line.split(sep).map(s => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      try {
        const w = await dbAddWord(currentUser.id, parts[0], parts[1]);
        if (w) { words.push(w); added++; }
      } catch(e) {}
    }
  }
  document.getElementById('inp-import').value = '';
  if (added > 0) { renderDashboard(); renderWordList(); alert(`Добавлено ${added} слов!`); }
  else alert('Ничего не распознано. Формат: слово — перевод (по одному в строке)');
}

async function deleteWord(id) {
  try {
    await dbDeleteWord(id);
    words = words.filter(w => w.id !== id);
    renderDashboard(); renderWordList();
  } catch(e) { alert('ошибка'); }
}

async function updateScore(id, delta) {
  const w = words.find(x => x.id === id);
  if (!w) return;
  const newScore = Math.max(0, Math.min(6, (w.score||0) + delta));
  w.score = newScore;
  w.last_reviewed = new Date().toISOString();
  w.review_count = (w.review_count||0) + 1;
  w.next_review = calcNextReview(newScore);
  try {
    await dbUpdateWord(id, {
      score: newScore,
      last_reviewed: w.last_reviewed,
      review_count: w.review_count,
      next_review: w.next_review
    });
  } catch(e) {}
}

function setFilter(f, btn) {
  wordFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderWordList();
}

function getFilteredWords() {
  if (wordFilter === 'new')      return words.filter(w => (w.score||0) === 0);
  if (wordFilter === 'learning') return words.filter(w => (w.score||0) > 0 && (w.score||0) < 6);
  if (wordFilter === 'know')     return words.filter(w => (w.score||0) >= 6);
  return words;
}

function renderWordList() {
  const el = document.getElementById('wlist');
  const list = getFilteredWords();
  if (!list.length) { el.innerHTML = '<div class="empty">нет слов в этой категории</div>'; return; }
  el.innerHTML = list.map(w => {
    const s = w.score||0;
    let cls = 'b-new', lbl = 'new';
    if (s >= 6) { cls = 'b-know'; lbl = 'know'; }
    else if (s >= 2) { cls = 'b-learn'; lbl = 'learning'; }
    return `<div class="wi" onclick="openWordModal(${w.id})">
      <div style="flex:1;min-width:0">
        <span class="we">${esc(w.en)}</span>
        ${w.transcription ? `<span class="wtr"> [${esc(w.transcription)}]</span>` : ''}
      </div>
      <span class="wr">${esc(w.ru)}</span>
      <span class="badge ${cls}">${lbl}</span>
    </div>`;
  }).join('');
}

// ── WORD MODAL ────────────────────────────────
function openWordModal(id) {
  const w = words.find(x => x.id === id);
  if (!w) return;
  const s = w.score||0;
  const pct = Math.round((s / 6) * 100);
  const reviewed = w.last_reviewed
    ? new Date(w.last_reviewed).toLocaleDateString('ru-RU')
    : 'никогда';
  document.getElementById('modal-body').innerHTML = `
    <div class="modal-word">${esc(w.en)}</div>
    ${w.transcription ? `<div class="modal-tr">[${esc(w.transcription)}]</div>` : ''}
    <div class="modal-ru">${esc(w.ru)}</div>
    <div class="modal-meta">повторений: ${w.review_count||0} · последний раз: ${reviewed}</div>
    <div class="modal-score-bar"><div class="modal-score-fill" style="width:${pct}%"></div></div>
    <div class="modal-meta">уровень знания: ${s}/6</div>
  `;
  document.getElementById('modal-delete-btn').onclick = () => { deleteWord(id); closeWordModal(); };
  document.getElementById('word-modal').classList.add('active');
}
function closeWordModal() {
  document.getElementById('word-modal').classList.remove('active');
}

// ── DASHBOARD ─────────────────────────────────
function renderDashboard() {
  const total = words.length;
  const know  = words.filter(w => (w.score||0) >= 6).length;
  const learn = words.filter(w => (w.score||0) > 0 && (w.score||0) < 6).length;
  const newW  = words.filter(w => (w.score||0) === 0).length;

  document.getElementById('dash-total').textContent    = total;
  document.getElementById('dash-know').textContent     = know;
  document.getElementById('dash-learning').textContent = learn;
  document.getElementById('dash-new').textContent      = newW;

  // Daily goal
  const goal = currentUser?.daily_goal || 10;
  document.getElementById('goal-total').textContent = goal;
  document.getElementById('goal-done').textContent  = dailyDone;
  const pct = Math.min(100, Math.round((dailyDone / goal) * 100));
  document.getElementById('goal-pct').textContent = pct + '%';
  const circ = 113;
  document.getElementById('goal-arc').style.strokeDashoffset = circ - (circ * pct / 100);

  // Study button count
  const due = getDueWords();
  const badge = document.getElementById('study-count-badge');
  if (due.length > 0) badge.textContent = due.length + ' слов';
  else badge.textContent = '';

  // Word map
  renderWordMap();
  renderDueList();
}

function getDueWords() {
  const now = new Date();
  return words.filter(w => !w.next_review || new Date(w.next_review) <= now);
}

function renderWordMap() {
  const el = document.getElementById('word-map');
  if (!words.length) { el.innerHTML = ''; return; }
  el.innerHTML = words.map(w => {
    const s = Math.min(4, w.score||0);
    return `<div class="wm-dot wm-${s}" title="${esc(w.en)}" onclick="openWordModal(${w.id})"></div>`;
  }).join('');
}

function renderDueList() {
  const el = document.getElementById('due-list');
  const due = getDueWords().slice(0, 8);
  const cnt = document.getElementById('due-count');
  cnt.textContent = getDueWords().length || '';
  if (!due.length) { el.innerHTML = '<div class="empty" style="padding:1rem">все слова повторены 🎉</div>'; return; }
  el.innerHTML = due.map(w => {
    const s = w.score||0;
    let cls = 'b-new', lbl = 'new';
    if (s >= 6) { cls = 'b-know'; lbl = 'know'; }
    else if (s >= 2) { cls = 'b-learn'; lbl = 'learning'; }
    return `<div class="due-item" onclick="openWordModal(${w.id})">
      <span class="due-en">${esc(w.en)}</span>
      <span class="due-ru">${esc(w.ru)}</span>
      <span class="badge ${cls}">${lbl}</span>
    </div>`;
  }).join('');
}

// ── NAVIGATION ────────────────────────────────
function switchTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.bnav').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

function setDir(d) {
  direction = d;
  document.getElementById('dir-en').classList.toggle('active', d === 'en');
  document.getElementById('dir-ru').classList.toggle('active', d === 'ru');
}

// ── SMART SESSION (from dashboard) ───────────
function startSmartSession() {
  const due = getDueWords();
  if (!due.length && words.length === 0) { alert('Сначала добавь слова!'); return; }
  // Auto-pick mode based on word scores
  const avgScore = words.reduce((a, w) => a + (w.score||0), 0) / (words.length || 1);
  let mode = 'flashcard';
  if (avgScore > 1) mode = 'choice';
  if (avgScore > 3) mode = 'typing';
  startSession(mode, due.length > 0 ? due : words);
}

function startSession(mode, pool = null) {
  sessionMode = mode;
  sessionIndex = 0;
  sessionScore = 0;
  sessionMistakes = [];
  chAnswered = false;
  fcRevealed = false;

  // Pick words pool: prefer due words
  const due = getDueWords();
  const src = pool || (due.length >= 4 ? due : words);
  if (!src.length) { alert('Добавь слова чтобы начать!'); return; }

  // Weighted shuffle using SRS
  sessionWords = srsQueue(src, SESSION_SIZE);

  document.getElementById('session-overlay').classList.add('active');
  renderSessionCard();
}

function srsQueue(pool, count) {
  const weighted = [];
  pool.forEach(w => {
    const wt = Math.max(1, 5 - Math.floor((w.score||0) / 2));
    for (let i = 0; i < wt; i++) weighted.push(w);
  });
  weighted.sort(() => Math.random() - 0.5);
  // deduplicate
  const seen = new Set();
  const result = [];
  for (const w of weighted) {
    if (!seen.has(w.id)) { seen.add(w.id); result.push(w); }
    if (result.length >= count) break;
  }
  // pad if not enough
  if (result.length < Math.min(count, pool.length)) {
    for (const w of pool) {
      if (!seen.has(w.id)) { seen.add(w.id); result.push(w); }
      if (result.length >= count) break;
    }
  }
  return result;
}

function closeSession() {
  if (matchTimer) { clearInterval(matchTimer); matchTimer = null; }
  document.getElementById('session-overlay').classList.remove('active');
  renderDashboard();
  renderWordList();
}

function updateSessionProgress() {
  const total = sessionWords.length;
  const pct = Math.round((sessionIndex / total) * 100);
  document.getElementById('session-pbar-fill').style.width = pct + '%';
  document.getElementById('session-counter').textContent = `${sessionIndex} / ${total}`;
  document.getElementById('session-score').textContent = sessionScore;
}

function renderSessionCard() {
  updateSessionProgress();
  if (sessionIndex >= sessionWords.length) { showSessionResult(); return; }
  const w = sessionWords[sessionIndex];
  if (sessionMode === 'flashcard') renderFC(w);
  if (sessionMode === 'choice')    renderCH(w);
  if (sessionMode === 'typing')    renderTY(w);
  if (sessionMode === 'match')     renderMatch();
}

// ── FLASHCARD ─────────────────────────────────
function renderFC(w) {
  const q = direction === 'en' ? w.en : w.ru;
  const a = direction === 'en' ? w.ru : w.en;
  if (!fcRevealed) {
    document.getElementById('session-body').innerHTML = `
      <div class="fc-card" onclick="revealFC()">
        <span class="fc-hint">нажми чтобы открыть</span>
        <div class="fc-word">${esc(q)}</div>
        ${w.transcription && direction === 'en' ? `<div class="fc-transcription">[${esc(w.transcription)}]</div>` : ''}
      </div>`;
  } else {
    document.getElementById('session-body').innerHTML = `
      <div class="fc-card" style="cursor:default">
        <div class="fc-word">${esc(q)}</div>
        ${w.transcription && direction === 'en' ? `<div class="fc-transcription">[${esc(w.transcription)}]</div>` : ''}
        <div class="fc-answer">${esc(a)}</div>
      </div>
      <div class="rate-row">
        <button class="btn danger-btn" onclick="fcRate(${w.id},-1)">не знал</button>
        <button class="btn" onclick="fcRate(${w.id},1)">сомневался</button>
        <button class="btn acc" onclick="fcRate(${w.id},3)">знал ✓</button>
      </div>`;
  }
}
function revealFC() { fcRevealed = true; renderFC(sessionWords[sessionIndex]); }
async function fcRate(id, d) {
  if (d > 0) { sessionScore++; dailyDone++; }
  else sessionMistakes.push(sessionWords[sessionIndex]);
  await updateScore(id, d);
  fcRevealed = false; sessionIndex++;
  renderSessionCard();
}

// ── CHOICE ────────────────────────────────────
function renderCH(w) {
  const q  = direction === 'en' ? w.en : w.ru;
  const ca = direction === 'en' ? w.ru : w.en;
  const others = words.filter(x => x.id !== w.id).sort(() => Math.random() - 0.5).slice(0, 3);
  const opts = [{ id: w.id, t: ca }, ...others.map(o => ({ id: o.id, t: direction === 'en' ? o.ru : o.en }))].sort(() => Math.random() - 0.5);
  document.getElementById('session-body').innerHTML = `
    <div class="q-word">${esc(q)}</div>
    ${w.transcription && direction === 'en' ? `<div class="q-transcription">[${esc(w.transcription)}]</div>` : ''}
    <div class="choices">${opts.map(o => `<button class="ch-btn" id="co${o.id}" onclick="answerCH(${w.id},${o.id})">${esc(o.t)}</button>`).join('')}</div>
    <div id="wrong-explain" class="wrong-explain"></div>
    <div class="next-wrap" id="chnxt"><button class="btn solid" onclick="nextCH()">далее →</button></div>`;
}
async function answerCH(cid, chosen) {
  if (chAnswered) return;
  chAnswered = true;
  const ok = cid === chosen;
  document.querySelectorAll('.ch-btn').forEach(b => b.disabled = true);
  document.getElementById('co' + cid).classList.add('ok');
  if (!ok) {
    document.getElementById('co' + chosen).classList.add('no');
    sessionMistakes.push(sessionWords[sessionIndex]);
    const correct = sessionWords[sessionIndex];
    const ex = document.getElementById('wrong-explain');
    ex.style.display = 'block';
    ex.textContent = `правильный ответ: ${direction === 'en' ? correct.ru : correct.en}`;
  } else {
    sessionScore++; dailyDone++;
  }
  await updateScore(cid, ok ? 2 : -1);
  document.getElementById('chnxt').style.display = 'block';
}
function nextCH() {
  chAnswered = false; sessionIndex++;
  renderSessionCard();
}

// ── TYPING ────────────────────────────────────
function renderTY(w) {
  const q = direction === 'en' ? w.ru : w.en;
  const a = direction === 'en' ? w.en : w.ru;
  const body = document.getElementById('session-body');
  body.dataset.ans = a; body.dataset.wid = w.id;
  body.innerHTML = `
    <div class="t-question">${esc(q)}</div>
    ${w.transcription && direction === 'ru' ? `<div class="t-transcription">[${esc(w.transcription)}]</div>` : ''}
    <div class="t-input-row">
      <input type="text" id="tyi" placeholder="введи перевод..." onkeydown="if(event.key==='Enter')checkTY()"/>
      <button class="btn solid" onclick="checkTY()">✓</button>
    </div>
    <div id="tyr" class="t-result"></div>
    <span class="skip-link" onclick="skipTY()">пропустить</span>`;
  setTimeout(() => { const i = document.getElementById('tyi'); if (i) i.focus(); }, 50);
}

function smartMatch(input, correct) {
  const a = input.toLowerCase().trim();
  const b = correct.toLowerCase().trim();
  if (a === b) return 'ok';
  // ignore articles
  const stripArticles = s => s.replace(/^(a |an |the |to )/i, '').trim();
  if (stripArticles(a) === stripArticles(b)) return 'ok';
  // 1-2 char typo
  if (Math.abs(a.length - b.length) <= 2) {
    let diff = 0;
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) { if (a[i] !== b[i]) diff++; }
    if (diff <= 2 && diff > 0) return 'near';
  }
  return 'fail';
}

async function checkTY() {
  const body = document.getElementById('session-body');
  const inp = document.getElementById('tyi');
  const res = document.getElementById('tyr');
  if (!inp || !res || !inp.value.trim()) return;
  const ua  = inp.value.trim();
  const ca  = body.dataset.ans;
  const wid = parseInt(body.dataset.wid);
  const result = smartMatch(ua, ca);
  res.style.display = 'block';
  inp.disabled = true;
  if (result === 'ok') {
    res.className = 't-result t-ok';
    res.textContent = '✓ верно!';
    sessionScore++; dailyDone++;
    await updateScore(wid, 2);
    sessionIndex++;
    setTimeout(renderSessionCard, 1200);
  } else if (result === 'near') {
    res.className = 't-result t-near';
    res.textContent = '~ почти! правильно: ' + ca;
    await updateScore(wid, 1);
    dailyDone++;
    sessionIndex++;
    setTimeout(renderSessionCard, 1800);
  } else {
    res.className = 't-result t-fail';
    res.textContent = '✗ ' + ca;
    sessionMistakes.push(sessionWords[sessionIndex]);
    await updateScore(wid, -1);
    sessionIndex++;
    setTimeout(renderSessionCard, 1800);
  }
}
function skipTY() { sessionIndex++; renderSessionCard(); }

// ── MATCH ─────────────────────────────────────
function renderMatch() {
  if (matchTimer) { clearInterval(matchTimer); matchTimer = null; }
  matchSeconds = 0;
  const pool = [...words].sort(() => Math.random() - 0.5).slice(0, 6);
  const en = pool.map(w => ({ id: w.id, t: w.en })).sort(() => Math.random() - 0.5);
  const ru = pool.map(w => ({ id: w.id, t: w.ru })).sort(() => Math.random() - 0.5);
  matchState = { sel: null, matched: [], pairs: pool };
  document.getElementById('session-body').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
      <span class="match-hint">выбери слово, затем перевод</span>
      <span id="match-timer" class="match-timer">0:00</span>
    </div>
    <div class="match-cols">
      <div class="match-col" id="mcol-en">${en.map(i => `<button class="m-btn" id="me${i.id}" onclick="selMatch('en',${i.id})">${esc(i.t)}</button>`).join('')}</div>
      <div class="match-col" id="mcol-ru">${ru.map(i => `<button class="m-btn" id="mr${i.id}" onclick="selMatch('ru',${i.id})">${esc(i.t)}</button>`).join('')}</div>
    </div>
    <div id="mmsg" class="match-msg"></div>`;
  matchTimer = setInterval(() => {
    matchSeconds++;
    const m = Math.floor(matchSeconds / 60);
    const s = matchSeconds % 60;
    const el = document.getElementById('match-timer');
    if (el) el.textContent = `${m}:${String(s).padStart(2,'0')}`;
  }, 1000);
}

async function selMatch(lang, id) {
  if (matchState.matched.includes(id)) return;
  const msg = document.getElementById('mmsg');
  if (lang === 'en') {
    document.querySelectorAll('[id^="me"]').forEach(b => b.classList.remove('m-sel'));
    matchState.sel = id;
    document.getElementById('me' + id).classList.add('m-sel');
    msg.textContent = 'теперь выбери перевод';
  } else {
    if (!matchState.sel) { msg.textContent = 'сначала выбери английское слово'; return; }
    const sid = matchState.sel; matchState.sel = null;
    document.getElementById('me' + sid).classList.remove('m-sel');
    if (sid === id) {
      document.getElementById('me' + id).classList.add('m-ok');
      document.getElementById('mr' + id).classList.add('m-ok');
      document.getElementById('me' + id).disabled = true;
      document.getElementById('mr' + id).disabled = true;
      matchState.matched.push(id);
      await updateScore(id, 1); dailyDone++;
      msg.textContent = '✓ верно!';
      if (matchState.matched.length === matchState.pairs.length) {
        clearInterval(matchTimer); matchTimer = null;
        sessionScore = matchState.pairs.length;
        sessionIndex = sessionWords.length; // trigger result
        setTimeout(showSessionResult, 600);
      }
    } else {
      const eb = document.getElementById('me' + sid);
      const rb = document.getElementById('mr' + id);
      eb.classList.add('m-err'); rb.classList.add('m-err');
      msg.textContent = 'не то, попробуй снова';
      setTimeout(() => { eb.classList.remove('m-err'); rb.classList.remove('m-err'); msg.textContent = ''; }, 700);
    }
  }
}

// ── SESSION RESULT ────────────────────────────
function showSessionResult() {
  updateStreak();
  renderDashboard();
  const total = sessionMode === 'match' ? matchState.pairs?.length || SESSION_SIZE : sessionWords.length;
  const pct = Math.round((sessionScore / total) * 100);
  let emoji = '📚'; if (pct >= 80) emoji = '🎉'; else if (pct >= 50) emoji = '💪';
  const mistakesHtml = sessionMistakes.length
    ? `<div class="result-mistakes">
        <div class="result-mistakes-title">ошибки — повтори:</div>
        ${sessionMistakes.slice(0,5).map(w => `<div class="mistake-item"><span class="mistake-en">${esc(w.en)}</span><span class="mistake-ru">${esc(w.ru)}</span></div>`).join('')}
       </div>`
    : '';
  document.getElementById('session-body').innerHTML = `
    <div class="result">
      <div class="result-emoji">${emoji}</div>
      <div class="result-big">${sessionScore}<span style="font-size:32px;color:var(--muted)">/${total}</span></div>
      <div class="result-label">${pct}% верно</div>
      <div class="result-sub">${pct >= 80 ? 'отличный результат!' : pct >= 50 ? 'хороший прогресс!' : 'продолжай практиковать'}</div>
      ${mistakesHtml}
      <div class="result-actions">
        <button class="btn" onclick="closeSession()">на главную</button>
        <button class="btn solid" onclick="startSession('${sessionMode}')">ещё раз</button>
      </div>
    </div>`;
  document.getElementById('session-pbar-fill').style.width = '100%';
  document.getElementById('session-counter').textContent = `${total} / ${total}`;
  document.getElementById('session-score').textContent = sessionScore;
}

// ── HELPERS ───────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
