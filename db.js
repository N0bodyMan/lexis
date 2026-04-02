// ═══════════════════════════════════════════════════════
// db.js v2 — защищённая версия
// Замени SURL и SKEY на свои значения из Supabase
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
