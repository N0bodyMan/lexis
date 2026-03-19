// ═══════════════════════════════════════════════
// app.js — логика приложения
// ═══════════════════════════════════════════════

let currentUser = null;
let words = [];
let fcMode = 'en', chMode = 'en', tyMode = 'en';
let fcRevealed = false;
let chAnswered = false, chScore = 0, chTotal = 0;
let tyScore = 0, tyTotal = 0;
let matchState = { sel: null, matched: [], pairs: [] };
const SESSION = 10;

// ── Telegram WebApp init ────────────────────────

window.Telegram?.WebApp?.ready();
window.Telegram?.WebApp?.expand();

// Если открыто в Telegram — пробуем авто-логин по username
(async function tryTelegramAuth() {
  const tg = window.Telegram?.WebApp;
  if (tg && tg.initDataUnsafe?.user?.username) {
    const tgName = tg.initDataUnsafe.user.username;
    try {
      let user = await dbGetUser(tgName);
      if (!user) {
        user = await dbCreateUser(tgName, await hashPass(tgName + '_tg'));
      }
      await loginSuccess(user);
    } catch (e) { /* fallback to manual auth */ }
  }
})();

// ── AUTH ─────────────────────────────────────────

async function authLogin() {
  const name = document.getElementById('auth-name').value.trim();
  const pass = document.getElementById('auth-pass').value.trim();
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';

  if (!name || !pass) { errEl.textContent = 'заполни все поля'; return; }
  if (pass.length < 4) { errEl.textContent = 'пароль минимум 4 символа'; return; }

  const btn = document.querySelector('#screen-auth .btn.solid');
  btn.textContent = 'загрузка...';
  btn.disabled = true;

  try {
    const passHash = await hashPass(pass);
    let user = await dbGetUser(name);

    if (!user) {
      // Создаём нового пользователя
      user = await dbCreateUser(name, passHash);
      if (!user) throw new Error('не удалось создать аккаунт');
    } else {
      // Проверяем пароль
      if (user.pass_hash !== passHash) {
        errEl.textContent = 'неверный пароль';
        btn.textContent = 'войти / создать аккаунт';
        btn.disabled = false;
        return;
      }
    }
    await loginSuccess(user);
  } catch (e) {
    errEl.textContent = 'ошибка: ' + e.message;
    btn.textContent = 'войти / создать аккаунт';
    btn.disabled = false;
  }
}

async function loginSuccess(user) {
  currentUser = user;
  localStorage.setItem('lexis_user', JSON.stringify(user));
  document.getElementById('header-user').textContent = user.name;
  document.getElementById('screen-auth').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  await loadWords();
}

function logout() {
  currentUser = null;
  localStorage.removeItem('lexis_user');
  words = [];
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('screen-auth').classList.add('active');
  document.getElementById('auth-name').value = '';
  document.getElementById('auth-pass').value = '';
}

// Авто-вход из localStorage
(async function autoLogin() {
  const saved = localStorage.getItem('lexis_user');
  if (saved) {
    try {
      const user = JSON.parse(saved);
      // Проверяем что пользователь ещё существует
      const fresh = await dbGetUser(user.name);
      if (fresh && fresh.pass_hash === user.pass_hash) {
        await loginSuccess(fresh);
      }
    } catch (e) { localStorage.removeItem('lexis_user'); }
  }
})();

// ── WORDS ────────────────────────────────────────

async function loadWords() {
  document.getElementById('wlist').innerHTML = '<div class="loading">загрузка...</div>';
  try {
    words = await dbGetWords(currentUser.id) || [];
    renderWords();
  } catch (e) {
    document.getElementById('wlist').innerHTML = '<div class="empty">ошибка загрузки</div>';
  }
}

async function addWord() {
  const en = document.getElementById('ien').value.trim();
  const ru = document.getElementById('iru').value.trim();
  if (!en || !ru) return;
  try {
    const w = await dbAddWord(currentUser.id, en, ru);
    if (w) { words.push(w); renderWords(); }
    document.getElementById('ien').value = '';
    document.getElementById('iru').value = '';
    document.getElementById('ien').focus();
  } catch (e) { alert('ошибка: ' + e.message); }
}

async function deleteWord(id) {
  try {
    await dbDeleteWord(id);
    words = words.filter(w => w.id !== id);
    renderWords();
  } catch (e) { alert('ошибка удаления'); }
}

async function updateScore(id, delta) {
  const w = words.find(x => x.id === id);
  if (!w) return;
  w.score = Math.max(0, (w.score || 0) + delta);
  try { await dbUpdateScore(id, w.score); } catch (e) {}
}

function renderWords() {
  document.getElementById('st-total').textContent = words.length;
  document.getElementById('st-know').textContent = words.filter(w => (w.score||0) >= 6).length;
  document.getElementById('st-new').textContent = words.filter(w => (w.score||0) === 0).length;
  const el = document.getElementById('wlist');
  if (!words.length) { el.innerHTML = '<div class="empty">добавь первое слово выше</div>'; return; }
  el.innerHTML = words.map(w => {
    const s = w.score || 0;
    let cls = 'b-new', lbl = 'new';
    if (s >= 6) { cls = 'b-know'; lbl = 'know'; }
    else if (s >= 2) { cls = 'b-learn'; lbl = 'learning'; }
    return `<div class="wi">
      <span class="we">${esc(w.en)}</span>
      <span class="wr">${esc(w.ru)}</span>
      <span class="badge ${cls}">${lbl}</span>
      <button class="btn sm danger-btn" onclick="deleteWord(${w.id})">✕</button>
    </div>`;
  }).join('');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── SRS (умное повторение) ───────────────────────

function srs(pool) {
  const weighted = [];
  pool.forEach(w => {
    const weight = Math.max(1, 5 - Math.floor((w.score||0) / 2));
    for (let i = 0; i < weight; i++) weighted.push(w);
  });
  return weighted[Math.floor(Math.random() * weighted.length)];
}

// ── NAVIGATION ──────────────────────────────────

function go(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('active'));
  document.getElementById('s-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'fc') { fcRevealed = false; renderFC(); }
  if (name === 'choice') { chScore = 0; chTotal = 0; chAnswered = false; renderCH(); }
  if (name === 'typing') { tyScore = 0; tyTotal = 0; renderTY(); }
  if (name === 'match') renderMatch();
}

function setMode(t, m) {
  if (t === 'fc') {
    fcMode = m;
    document.getElementById('fce').classList.toggle('active', m === 'en');
    document.getElementById('fcr').classList.toggle('active', m === 'ru');
    fcRevealed = false; renderFC();
  }
  if (t === 'ch') {
    chMode = m;
    document.getElementById('che').classList.toggle('active', m === 'en');
    document.getElementById('chr').classList.toggle('active', m === 'ru');
    chScore = 0; chTotal = 0; renderCH();
  }
  if (t === 'ty') {
    tyMode = m;
    document.getElementById('tye').classList.toggle('active', m === 'en');
    document.getElementById('tyr').classList.toggle('active', m === 'ru');
    tyScore = 0; tyTotal = 0; renderTY();
  }
}

// ── FLASHCARD ────────────────────────────────────

function renderFC() {
  const el = document.getElementById('fcb');
  if (!words.length) { el.innerHTML = '<div class="empty">добавь слова в разделе «слова»</div>'; return; }
  const w = srs(words);
  const q = fcMode === 'en' ? w.en : w.ru;
  const a = fcMode === 'en' ? w.ru : w.en;
  if (!fcRevealed) {
    el.innerHTML = `<div class="fc-card" onclick="revealFC(${w.id})">
      <span class="fc-hint">нажми чтобы открыть</span>
      <div class="fc-word">${esc(q)}</div>
    </div>`;
  } else {
    el.innerHTML = `<div class="fc-card" style="cursor:default">
      <div class="fc-word">${esc(q)}</div>
      <div class="fc-answer">${esc(a)}</div>
    </div>
    <div class="rate-row">
      <button class="btn danger-btn" onclick="fcRate(${w.id},-1)">не знал</button>
      <button class="btn" onclick="fcRate(${w.id},1)">сомневался</button>
      <button class="btn acc" onclick="fcRate(${w.id},3)">знал ✓</button>
    </div>`;
  }
}

function revealFC(id) { fcRevealed = true; renderFC(); }
async function fcRate(id, d) { await updateScore(id, d); fcRevealed = false; renderWords(); renderFC(); }

// ── CHOICE ───────────────────────────────────────

function renderCH() {
  const el = document.getElementById('chb');
  if (words.length < 4) { el.innerHTML = '<div class="empty">нужно минимум 4 слова</div>'; return; }
  if (chTotal >= SESSION) { showResult(el, chScore); return; }
  const w = srs(words);
  const q = chMode === 'en' ? w.en : w.ru;
  const ca = chMode === 'en' ? w.ru : w.en;
  const others = words.filter(x => x.id !== w.id).sort(() => Math.random() - 0.5).slice(0, 3);
  const opts = [{ id: w.id, t: ca }, ...others.map(o => ({ id: o.id, t: chMode === 'en' ? o.ru : o.en }))].sort(() => Math.random() - 0.5);
  const p = Math.round((chTotal / SESSION) * 100);
  el.innerHTML = `<div class="pbar"><div class="pbar-fill" style="width:${p}%"></div></div>
  <div class="q-counter">${chTotal + 1} / ${SESSION}</div>
  <div class="q-word">${esc(q)}</div>
  <div class="choices">${opts.map(o => `<button class="ch-btn" id="co${o.id}" onclick="answerCH(${w.id},${o.id})">${esc(o.t)}</button>`).join('')}</div>
  <div class="next-wrap" id="chnxt"><button class="btn solid" onclick="renderCH()">далее →</button></div>`;
}

async function answerCH(cid, chosen) {
  if (chAnswered) return;
  chAnswered = true; chTotal++;
  const ok = cid === chosen;
  if (ok) chScore++;
  document.querySelectorAll('.ch-btn').forEach(b => b.disabled = true);
  document.getElementById('co' + cid).classList.add('ok');
  if (!ok) document.getElementById('co' + chosen).classList.add('no');
  await updateScore(cid, ok ? 2 : -1);
  renderWords();
  document.getElementById('chnxt').style.display = 'block';
  chAnswered = false;
}

// ── TYPING ───────────────────────────────────────

function renderTY() {
  const el = document.getElementById('tyb');
  if (!words.length) { el.innerHTML = '<div class="empty">добавь слова</div>'; return; }
  if (tyTotal >= SESSION) { showResult(el, tyScore); return; }
  const w = srs(words);
  const q = tyMode === 'en' ? w.ru : w.en;
  const a = tyMode === 'en' ? w.en : w.ru;
  const p = Math.round((tyTotal / SESSION) * 100);
  el.dataset.ans = a;
  el.dataset.wid = w.id;
  el.innerHTML = `<div class="pbar"><div class="pbar-fill" style="width:${p}%"></div></div>
  <div class="q-counter">${tyTotal + 1} / ${SESSION}</div>
  <div class="t-question">${esc(q)}</div>
  <div class="t-input-row">
    <input type="text" id="tyi" placeholder="введи перевод..." onkeydown="if(event.key==='Enter')checkTY()"/>
    <button class="btn solid" onclick="checkTY()">✓</button>
  </div>
  <div id="tyr" class="t-result"></div>
  <span class="skip-link" onclick="tyTotal++;renderTY()">пропустить</span>`;
  setTimeout(() => { const i = document.getElementById('tyi'); if (i) i.focus(); }, 50);
}

async function checkTY() {
  const el = document.getElementById('tyb');
  const inp = document.getElementById('tyi');
  const res = document.getElementById('tyr');
  if (!inp || !res) return;
  const ua = inp.value.trim().toLowerCase();
  const ca = el.dataset.ans.toLowerCase();
  const wid = parseInt(el.dataset.wid);
  if (!ua) return;
  tyTotal++;
  const ok = ua === ca;
  if (ok) tyScore++;
  res.style.display = 'block';
  res.className = 't-result ' + (ok ? 't-ok' : 't-fail');
  res.textContent = ok ? '✓ верно!' : '✗ ' + el.dataset.ans;
  inp.disabled = true;
  await updateScore(wid, ok ? 2 : -1);
  renderWords();
  setTimeout(renderTY, 1400);
}

// ── MATCH ────────────────────────────────────────

function renderMatch() {
  const el = document.getElementById('mtb');
  if (words.length < 3) { el.innerHTML = '<div class="empty">нужно минимум 3 слова</div>'; return; }
  const pool = [...words].sort(() => Math.random() - 0.5).slice(0, 5);
  const enItems = pool.map(w => ({ id: w.id, t: w.en })).sort(() => Math.random() - 0.5);
  const ruItems = pool.map(w => ({ id: w.id, t: w.ru })).sort(() => Math.random() - 0.5);
  matchState = { sel: null, matched: [], pairs: pool };
  el.innerHTML = `<div class="match-hint">выбери английское слово, затем его перевод</div>
  <div class="match-cols">
    <div class="match-col">${enItems.map(i => `<button class="m-btn" id="me${i.id}" onclick="selectMatch('en',${i.id})">${esc(i.t)}</button>`).join('')}</div>
    <div class="match-col">${ruItems.map(i => `<button class="m-btn" id="mr${i.id}" onclick="selectMatch('ru',${i.id})">${esc(i.t)}</button>`).join('')}</div>
  </div>
  <div id="mmsg" class="match-msg"></div>
  <div id="mdone" style="display:none;text-align:center;margin-top:1.5rem;">
    <div style="font-family:'DM Serif Display',serif;font-size:28px;color:var(--acc);margin-bottom:12px;">все пары найдены!</div>
    <button class="btn solid" onclick="renderMatch()">ещё раз</button>
  </div>`;
}

async function selectMatch(lang, id) {
  if (matchState.matched.includes(id)) return;
  const msg = document.getElementById('mmsg');
  if (lang === 'en') {
    document.querySelectorAll('[id^="me"]').forEach(b => b.classList.remove('m-sel'));
    matchState.sel = id;
    document.getElementById('me' + id).classList.add('m-sel');
    msg.textContent = 'теперь выбери перевод';
  } else {
    if (!matchState.sel) { msg.textContent = 'сначала выбери английское слово'; return; }
    const sid = matchState.sel;
    matchState.sel = null;
    document.getElementById('me' + sid).classList.remove('m-sel');
    if (sid === id) {
      document.getElementById('me' + id).classList.add('m-ok');
      document.getElementById('mr' + id).classList.add('m-ok');
      document.getElementById('me' + id).disabled = true;
      document.getElementById('mr' + id).disabled = true;
      matchState.matched.push(id);
      await updateScore(id, 1);
      renderWords();
      msg.textContent = 'верно!';
      if (matchState.matched.length === matchState.pairs.length) {
        document.getElementById('mdone').style.display = 'block';
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

// ── RESULT ───────────────────────────────────────

function showResult(el, score) {
  const pct = Math.round((score / SESSION) * 100);
  const isChoice = el.id === 'chb';
  el.innerHTML = `<div class="result">
    <div class="result-score">${score}<span style="font-size:32px;color:var(--muted)">/${SESSION}</span></div>
    <div class="result-label">${pct}% верно</div>
    <div class="result-sub">${pct >= 80 ? 'отличный результат!' : 'продолжай практиковать'}</div>
    <button class="btn solid" onclick="${isChoice ? 'chScore=0;chTotal=0;renderCH()' : 'tyScore=0;tyTotal=0;renderTY()'}">ещё раз</button>
  </div>`;
}

// ── Enter на форме авторизации ────────────────────
document.getElementById('auth-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') authLogin();
});
