// ═══════════════════════════════════════════════
// db.js — Supabase layer  
// Замени SUPABASE_URL и SUPABASE_KEY своими данными
// ═══════════════════════════════════════════════

const SUPABASE_URL = 'https://kzrkssgxzgopbjavqfff.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6cmtzc2d4emdvcGJqYXZxZmZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NzUzNzksImV4cCI6MjA4OTQ1MTM3OX0.VQzgqXiRGPTIun53TE70u2OoT72ZehZrEqHrU3denmE';

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

// ── Users ────────────────────────────────────

async function dbGetUser(name) {
  const rows = await dbFetch(`users?name=eq.${encodeURIComponent(name)}&select=*`);
  return rows && rows.length > 0 ? rows[0] : null;
}

async function dbCreateUser(name, passHash) {
  const rows = await dbFetch('users', 'POST', { name, pass_hash: passHash, daily_goal: 10, streak: 0 });
  return rows && rows.length > 0 ? rows[0] : null;
}

async function dbUpdateUser(userId, fields) {
  const rows = await dbFetch(`users?id=eq.${userId}`, 'PATCH', fields);
  return rows && rows.length > 0 ? rows[0] : null;
}

// ── Words ────────────────────────────────────

async function dbGetWords(userId) {
  return await dbFetch(`words?user_id=eq.${userId}&order=created_at.asc&select=*`);
}

async function dbAddWord(userId, en, ru, transcription = '', tags = '') {
  const rows = await dbFetch('words', 'POST', {
    user_id: userId, en, ru, transcription, tags,
    score: 0, next_review: new Date().toISOString(), review_count: 0
  });
  return rows && rows.length > 0 ? rows[0] : null;
}

async function dbUpdateWord(wordId, fields) {
  await dbFetch(`words?id=eq.${wordId}`, 'PATCH', fields);
}

async function dbDeleteWord(wordId) {
  await dbFetch(`words?id=eq.${wordId}`, 'DELETE', null, { 'Prefer': '' });
}

// ── SRS: вычисляем следующий повтор ──────────
// Интервалы: 0→1мин, 1→10мин, 2→1д, 3→3д, 4→7д, 5→14д, 6→30д
function calcNextReview(score) {
  const intervals = [1, 10, 60*24, 60*24*3, 60*24*7, 60*24*14, 60*24*30];
  const idx = Math.min(score, intervals.length - 1);
  const minutes = intervals[idx];
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

// ── Streak ───────────────────────────────────

function calcStreak(user) {
  const today = new Date().toISOString().slice(0, 10);
  const last = user.last_practice;
  if (!last) return { streak: 1, last_practice: today };
  if (last === today) return { streak: user.streak, last_practice: today };
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (last === yesterday) return { streak: (user.streak || 0) + 1, last_practice: today };
  return { streak: 1, last_practice: today }; // streak broken
}

// ── Password hash ────────────────────────────

async function hashPass(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
