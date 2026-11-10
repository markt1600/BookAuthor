import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const state = globalThis.__LOOM_SQLITE__ ||= { db: null, timers: new Map() };
function db() {
  if (!state.db) {
    const dir = process.env.LOOM_DATA_DIR || join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    state.db = new DatabaseSync(join(dir, 'loom.sqlite'));
    state.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locks (key TEXT PRIMARY KEY, token TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  return state.db;
}
export function get(key) {
  const row = db().prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}
export function set(key, value) {
  db().prepare('INSERT INTO kv VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
}
export function del(key) { return db().prepare('DELETE FROM kv WHERE key = ?').run(key).changes > 0; }
export function books() { return db().prepare("SELECT value FROM kv WHERE key LIKE 'book:%'").all().map(r => JSON.parse(r.value)); }
export function lock(key) {
  const token = randomUUID(), now = Date.now();
  const result = db().prepare(`INSERT INTO locks VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE
    SET token=excluded.token, expires=excluded.expires WHERE locks.expires < ?`).run(key, token, now + 90000, now);
  if (!result.changes) return null;
  const timer = setInterval(() => {
    db().prepare('UPDATE locks SET expires=? WHERE key=? AND token=?').run(Date.now()+90000,key,token);
  }, 20000);
  timer.unref(); state.timers.set(token,timer);
  return token;
}
export function unlock(key, token) {
  clearInterval(state.timers.get(token)); state.timers.delete(token);
  db().prepare('DELETE FROM locks WHERE key=? AND token=?').run(key,token);
}
