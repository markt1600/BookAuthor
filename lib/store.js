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
