// ═══════════════════════════════════════════════
// db.js — Supabase database layer
// Замени SUPABASE_URL и SUPABASE_KEY своими данными
// ═══════════════════════════════════════════════

const SUPABASE_URL = 'https://kzrkssgxzgopbjavqfff.supabase.co';   // например: https://abcdefgh.supabase.co
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6cmtzc2d4emdvcGJqYXZxZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NzUzNzksImV4cCI6MjA4OTQ1MTM3OX0.VQzgqXiRGPTIun53TE70u2OoT72ZehZrEqHrU3denmE'; // длинная строка из Supabase

// ── Низкоуровневые запросы ──────────────────────

async function dbFetch(path, method = 'GET', body = null, extra = {}) {
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...extra
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'DB error ' + res.status);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ── Пользователи ────────────────────────────────

async function dbGetUser(name) {
  const rows = await dbFetch(`users?name=eq.${encodeURIComponent(name)}&select=*`);
  return rows && rows.length > 0 ? rows[0] : null;
}

async function dbCreateUser(name, passHash) {
  const rows = await dbFetch('users', 'POST', { name, pass_hash: passHash });
  return rows && rows.length > 0 ? rows[0] : null;
}

// ── Слова ───────────────────────────────────────

async function dbGetWords(userId) {
  return await dbFetch(`words?user_id=eq.${userId}&order=created_at.asc&select=*`);
}

async function dbAddWord(userId, en, ru) {
  const rows = await dbFetch('words', 'POST', {
    user_id: userId, en, ru, score: 0
  });
  return rows && rows.length > 0 ? rows[0] : null;
}

async function dbUpdateScore(wordId, score) {
  await dbFetch(`words?id=eq.${wordId}`, 'PATCH', { score });
}

async function dbDeleteWord(wordId) {
  await dbFetch(`words?id=eq.${wordId}`, 'DELETE', null, { 'Prefer': '' });
}

// ── Хэш пароля (простой, не крипто) ────────────

async function hashPass(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
