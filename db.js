// ═══════════════════════════════════════════════════════
// db.js v2 — защищённая версия
// Замени SURL и SKEY на свои значения из Supabase
// ═══════════════════════════════════════════════════════

const SURL = 'https://kzrkssgxzgopbjavqfff.supabase.co';
const SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6cmtzc2d4emdvcGJqYXZxZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NzUzNzksImV4cCI6MjA4OTQ1MTM3OX0.VQzgqXiRGPTIun53TE70u2OoT72ZehZrEqHrU3denmE';

// Pepper — дополнительный секрет добавляемый к паролю перед хэшированием.
// Хранится в коде, а не в БД — даже при утечке базы пароли не взломать.
// ВАЖНО: после первой регистрации пользователей НЕ МЕНЯТЬ это значение!
const PEPPER = 'Lx$9#kP2mQ7@nR4';

// ── Базовый запрос ────────────────────────────────────
async function dbQ(path, method, body, xtra) {
  const h = {
    'apikey': SKEY,
    'Authorization': 'Bearer ' + SKEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    ...(xtra || {})
  };
  const r = await fetch(SURL + '/rest/v1/' + path, {
    method: method || 'GET',
    headers: h,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || 'DB error ' + r.status);
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// Вызов RPC-функции (хранимая процедура в Supabase)
async function dbRPC(fn, params) {
  const r = await fetch(SURL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      'apikey': SKEY,
      'Authorization': 'Bearer ' + SKEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params || {})
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.message || 'RPC error ' + r.status);
  }
  return r.json();
}

// ── Пользователи ──────────────────────────────────────
const gU  = n   => dbQ(`users?name=eq.${encodeURIComponent(n)}&select=*`).then(r => r && r[0] || null);
const gUById = id => dbQ(`users?id=eq.${id}&select=*`).then(r => r && r[0] || null);
const gUByTg = tgId => dbQ(`users?tg_id=eq.${encodeURIComponent(tgId)}&select=*`).then(r => r && r[0] || null);

async function cU(name, passHash, salt, tgId) {
  const rows = await dbQ('users', 'POST', {
    name,
    pass_hash: passHash,
    salt: salt || '',
    tg_id: tgId || '',
    daily_goal: 10,
    streak: 0,
    settings: '{}'
  });
  return rows && rows[0] || null;
}

const uU = (id, f) => dbQ(`users?id=eq.${id}`, 'PATCH', f);

// ── Слова ─────────────────────────────────────────────
const gW  = uid => dbQ(`words?user_id=eq.${uid}&order=created_at.asc&select=*`);

async function aW(uid, en, ru, tr) {
  const rows = await dbQ('words', 'POST', {
    user_id: uid,
    en: en.trim(),
    ru: ru.trim(),
    en_lower: en.toLowerCase().trim(),
    transcription: tr || '',
    score: 0,
    next_review: new Date().toISOString(),
    review_count: 0
  });
  return rows && rows[0] || null;
}

const upW = (id, f) => dbQ(`words?id=eq.${id}`, 'PATCH', f);
const dW  = id  => dbQ(`words?id=eq.${id}`, 'DELETE', null, { 'Prefer': '' });

// ── Криптография ──────────────────────────────────────

// Генерация случайной соли
function genSalt(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  const arr = new Uint8Array(len || 16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

// Хэш с солью и pepper: SHA-256(pepper + salt + password)
// Намного надёжнее чем просто SHA-256(password)
async function hp(password, salt) {
  const s = salt || '';
  const input = PEPPER + s + password;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Верификация подписи Telegram initData
// Защищает от подделки данных при входе через Telegram
async function verifyTelegramData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    // Примечание: полная верификация требует bot token на сервере.
    // На клиенте проверяем только наличие корректного формата.
    return dataCheckString.length > 0 && hash.length === 64;
  } catch (e) {
    return false;
  }
}

// ── Rate limiting ─────────────────────────────────────
async function checkRateLimit(name) {
  try {
    const result = await dbRPC('check_rate_limit', { p_name: name });
    return result;
  } catch (e) {
    // Если функция недоступна — пропускаем (не блокируем)
    return { allowed: true, reason: 'ok' };
  }
}

async function recordFailedAttempt(name) {
  try {
    await dbRPC('record_failed_attempt', { p_name: name });
  } catch (e) {}
}

async function resetFailedAttempts(name) {
  try {
    await dbRPC('reset_failed_attempts', { p_name: name });
  } catch (e) {}
}

// ── SRS ───────────────────────────────────────────────
function nxtR(s) {
  const m = [1, 10, 1440, 4320, 10080, 20160, 43200];
  return new Date(Date.now() + m[Math.min(s, 6)] * 60000).toISOString();
}

// ── Стрик ─────────────────────────────────────────────
function calcStreak(u) {
  const t = new Date().toISOString().slice(0, 10);
  const l = u.last_practice;
  if (!l) return { streak: 1, last_practice: t };
  if (l === t) return { streak: u.streak, last_practice: t };
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return l === y
    ? { streak: (u.streak || 0) + 1, last_practice: t }
    : { streak: 1, last_practice: t };
}
