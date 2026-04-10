// ═══════════════════════════════════════════════════════
// db.js — тонкий клиент (только безопасные запросы)
// Парольная логика перенесена в Edge Functions
// ═══════════════════════════════════════════════════════

const SURL = 'https://kzrkssgxzgopbjavqfff.supabase.co';
const SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6cmtzc2d4emdvcGJqYXZxZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NzUzNzksImV4cCI6MjA4OTQ1MTM3OX0.VQzgqXiRGPTIun53TE70u2OoT72ZehZrEqHrU3denmE';

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

// Вызов RPC-функции
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

// ── Пользователи (только через Edge Functions) ────────
// Авто-вход — через auth-restore, не прямой запрос к users
async function gUById(id) {
  const r = await fetch(`${SURL}/functions/v1/auth-restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SKEY },
    body: JSON.stringify({ id })
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.user || null;
}

// Обновление пользователя — через user-update, не прямой PATCH
async function uU(id, fields) {
  try {
    await fetch(`${SURL}/functions/v1/user-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SKEY },
      body: JSON.stringify({ id, fields })
    });
  } catch(e) {
    console.warn('user-update failed:', e.message);
  }
}

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

// ── Rate limiting (через RPC) ─────────────────────────
async function checkRateLimit(name) {
  try {
    return await dbRPC('check_rate_limit', { p_name: name });
  } catch (e) {
    return { allowed: true, reason: 'ok' };
  }
}

async function recordFailedAttempt(name) {
  try { await dbRPC('record_failed_attempt', { p_name: name }); } catch (e) {}
}

async function resetFailedAttempts(name) {
  try { await dbRPC('reset_failed_attempts', { p_name: name }); } catch (e) {}
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
