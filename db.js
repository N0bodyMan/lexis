// ═══════════════════════════════════════════════
// db.js — здесь только твои ключи и запросы к БД
// Этот файл НЕ трогаешь при обновлении дизайна
// ═══════════════════════════════════════════════

const SURL = 'https://kzrkssgxzgopbjavqfff.supabase.co';       // https://xxxxxxxx.supabase.co
const SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6cmtzc2d4emdvcGJqYXZxZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NzUzNzksImV4cCI6MjA4OTQ1MTM3OX0.VQzgqXiRGPTIun53TE70u2OoT72ZehZrEqHrU3denmE';  // eyJhbGci...

// ── Запросы ─────────────────────────────────────
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

// ── Пользователи ────────────────────────────────
const gU  = n  => dbQ(`users?name=eq.${encodeURIComponent(n)}&select=*`).then(r => r && r[0] || null);
const cU  = (n, ph) => dbQ('users', 'POST', { name: n, pass_hash: ph, daily_goal: 10, streak: 0 }).then(r => r && r[0] || null);
const uU  = (id, f) => dbQ(`users?id=eq.${id}`, 'PATCH', f);

// ── Слова ───────────────────────────────────────
const gW  = uid => dbQ(`words?user_id=eq.${uid}&order=created_at.asc&select=*`);
const aW  = (uid, en, ru, tr) => dbQ('words', 'POST', {
  user_id: uid, en, ru, transcription: tr || '',
  score: 0, next_review: new Date().toISOString(), review_count: 0
}).then(r => r && r[0] || null);
const upW = (id, f) => dbQ(`words?id=eq.${id}`, 'PATCH', f);
const dW  = id => dbQ(`words?id=eq.${id}`, 'DELETE', null, { 'Prefer': '' });

// ── SRS: следующий повтор ───────────────────────
function nxtR(s) {
  const m = [1, 10, 1440, 4320, 10080, 20160, 43200];
  return new Date(Date.now() + m[Math.min(s, 6)] * 60000).toISOString();
}

// ── Стрик ───────────────────────────────────────
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

// ── Хэш пароля ─────────────────────────────────
async function hp(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}
