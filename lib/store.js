import { Redis } from "@upstash/redis";

// Upstash Redis (the storage Vercel KV migrated to) injects REST credentials as
// env vars. Vercel's integration uses KV_REST_API_*, a direct Upstash project
// uses UPSTASH_REDIS_REST_*. We accept either so the same code works with both.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const hasKV = Boolean(KV_URL && KV_TOKEN);

let _client = null;
function redis() {
  if (!_client) _client = new Redis({ url: KV_URL, token: KV_TOKEN });
  return _client;
}

// Local-dev fallback. NOT persistent across server restarts or serverless
// invocations — production must configure Redis. We stash it on globalThis so
// it survives hot-reloads in `next dev`.
const mem = globalThis.__LOOM_MEM__ || (globalThis.__LOOM_MEM__ = new Map());

const key = (id) => `book:${id}`;

export const storageMode = hasKV ? "redis" : "memory";

export async function saveBook(book) {
  book.updatedAt = Date.now();
  if (hasKV) {
    // @upstash/redis serializes/deserializes JSON automatically.
    await redis().set(key(book.id), book);
  } else {
    mem.set(book.id, JSON.parse(JSON.stringify(book)));
  }
  return book;
}

export async function getBook(id) {
  if (!id) return null;
  if (hasKV) {
    const book = await redis().get(key(id));
    return book || null;
  }
  const book = mem.get(id);
  return book ? JSON.parse(JSON.stringify(book)) : null;
}

export async function deleteBook(id) {
  if (!id) return false;
  if (hasKV) {
    await redis().del(key(id));
    return true;
  }
  return mem.delete(id);
}

// Returns every stored book. Fine for a personal/small instance; for a large
// library you'd paginate. Newest first.
export async function listBooks() {
  let books = [];
  if (hasKV) {
    const keys = await redis().keys("book:*");
    if (keys.length) {
      const values = await redis().mget(...keys);
      books = values.filter(Boolean);
    }
  } else {
    books = [...mem.values()].map((b) => JSON.parse(JSON.stringify(b)));
  }
  books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return books;
}

// ---- Per-book write lock ---------------------------------------------------
// Guards the generation routes (turn / regenerate / rewrite): two overlapping
// requests could otherwise both pass the "is it your move" check and both
// append. The TTL matches the routes' maxDuration so a killed invocation can
// never wedge a book for longer than one request's ceiling.
const LOCK_TTL_S = 300;
const lockKey = (bookId) => `lock:${bookId}`;

export async function acquireLock(bookId) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  if (hasKV) {
    const ok = await redis().set(lockKey(bookId), token, { nx: true, ex: LOCK_TTL_S });
    return ok ? token : null;
  }
  const now = Date.now();
  const cur = mem.get(lockKey(bookId));
  if (cur && cur.expires > now) return null;
  mem.set(lockKey(bookId), { token, expires: now + LOCK_TTL_S * 1000 });
  return token;
}

// Release only if we still hold it (an expired-and-reacquired lock stays put).
export async function releaseLock(bookId, token) {
  if (!token) return;
  if (hasKV) {
    const cur = await redis().get(lockKey(bookId));
    if (cur === token) await redis().del(lockKey(bookId));
    return;
  }
  const cur = mem.get(lockKey(bookId));
  if (cur && cur.token === token) mem.delete(lockKey(bookId));
}

// ---- Revision history (snapshots) -----------------------------------------
// A capped, newest-first list of prior book states so destructive actions
// (full-text edits, regenerate, chapter changes, restores) are reversible.
const SNAP_CAP = 12;
const snapKey = (bookId) => `snaps:${bookId}`;

async function readSnaps(bookId) {
  if (hasKV) return (await redis().get(snapKey(bookId))) || [];
  return mem.get(snapKey(bookId)) || [];
}
async function writeSnaps(bookId, snaps) {
  if (hasKV) await redis().set(snapKey(bookId), snaps);
  else mem.set(snapKey(bookId), JSON.parse(JSON.stringify(snaps)));
}

// Save the current book state as a snapshot, labelled with a reason.
export async function saveSnapshot(book, reason) {
  if (!book || !book.id) return null;
  const snaps = await readSnaps(book.id);
  const snap = {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    reason: String(reason || "edit"),
    words: (book.turns || []).reduce((n, t) => n + (t.words || 0), 0),
    turns: (book.turns || []).length,
    chapters: (book.chapters || []).length,
    book: JSON.parse(JSON.stringify(book)),
  };
  snaps.unshift(snap);
  while (snaps.length > SNAP_CAP) snaps.pop();
  await writeSnaps(book.id, snaps);
  return snap.id;
}

// Lightweight metadata for the history UI (no heavy book payloads).
export async function listSnapshots(bookId) {
  const snaps = await readSnaps(bookId);
  return snaps.map(({ id, at, reason, words, turns, chapters }) => ({
    id,
    at,
    reason,
    words,
    turns,
    chapters,
  }));
}

// The full stored book state for one snapshot.
export async function getSnapshot(bookId, snapId) {
  const snaps = await readSnaps(bookId);
  const s = snaps.find((x) => x.id === snapId);
  return s ? JSON.parse(JSON.stringify(s.book)) : null;
}

export async function deleteSnapshots(bookId) {
  if (hasKV) await redis().del(snapKey(bookId));
  else mem.delete(snapKey(bookId));
}
