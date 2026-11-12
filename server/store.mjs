/**
 * Tiny JSON-file store for accounts, chip balances, pending grants and orders.
 *
 * Deliberately dependency-free (no DB) — good enough for a hobby Mini App and
 * trivially deployable to a free PaaS. Set `DATA_DIR` to a mounted volume to
 * persist across restarts (Amvera: mount a persistent volume at /data).
 */

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { accounts: {}, orders: {}, scores: {} };
let dirty = false;
let flushTimer = null;

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.accounts ||= {};
      db.orders ||= {};
      db.scores ||= {};
    }
  } catch (err) {
    console.warn('[store] failed to load db, starting empty:', err.message);
  }
}

function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.warn('[store] failed to persist db:', err.message);
  }
}

function markDirty() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 500);
  if (flushTimer.unref) flushTimer.unref();
}

load();

export function ensureAccount(id, name) {
  const key = String(id);
  if (!db.accounts[key]) {
    db.accounts[key] = {
      id: key,
      name: name || 'Игрок',
      chips: 0,
      pending: 0,
      purchases: [],
      createdAt: Date.now(),
    };
    markDirty();
  } else if (name && db.accounts[key].name !== name) {
    db.accounts[key].name = name;
    markDirty();
  }
  return db.accounts[key];
}

export function getAccount(id) {
  return db.accounts[String(id)] || null;
}

/** Credit chips immediately. */
export function addChips(id, amount, meta) {
  const acc = ensureAccount(id);
  acc.chips += Math.floor(amount);
  if (meta) acc.purchases.push({ ...meta, at: Date.now() });
  markDirty();
  return acc;
}

/** Record chips that could not be delivered (recipient offline). */
export function addPending(id, amount, meta) {
  const acc = ensureAccount(id);
  acc.pending += Math.floor(amount);
  if (meta) acc.purchases.push({ ...meta, at: Date.now(), pending: true });
  markDirty();
  return acc;
}

/** Take everything pending (called when a client connects). */
export function drainPending(id) {
  const acc = getAccount(id);
  if (!acc || !acc.pending) return 0;
  const amount = acc.pending;
  acc.pending = 0;
  markDirty();
  return amount;
}

export function createOrder(order) {
  db.orders[order.id] = { ...order, status: 'pending', createdAt: Date.now() };
  markDirty();
  return db.orders[order.id];
}

export function getOrder(id) {
  return db.orders[String(id)] || null;
}

export function completeOrder(id) {
  const o = db.orders[String(id)];
  if (!o) return null;
  o.status = 'paid';
  o.paidAt = Date.now();
  markDirty();
  return o;
}

/** Force a synchronous write (used on shutdown). */
export function flushNow() {
  flush();
}

/* ───────────────────────── global leaderboard ───────────────────────── */

function clampScore(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 1_000_000);
}

/**
 * Publish the best score of an account. Only the better of the stored/new
 * value is kept, so replaying an old match cannot lower a player's rank.
 */
export function submitScore(accountId, name, chips, wins) {
  const id = String(accountId);
  const score = db.scores[id] || {
    id,
    name: name || 'Игрок',
    chips: 0,
    wins: 0,
    at: 0,
  };
  if (name && name !== score.name) score.name = name;
  score.chips = Math.max(score.chips, clampScore(chips));
  score.wins = Math.max(score.wins, clampScore(wins));
  score.at = Date.now();
  db.scores[id] = score;
  markDirty();
  return score;
}

export function getLeaderboard(limit = 20) {
  return Object.values(db.scores)
    .sort((a, b) => b.chips - a.chips || b.wins - a.wins || a.at - b.at)
    .slice(0, Math.max(1, Math.floor(limit) || 20));
}
