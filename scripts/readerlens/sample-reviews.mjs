// Stream a gzipped JSONL of Goodreads reviews on stdin; emit a balanced,
// quality-filtered sample as JSONL. Usage:
//   curl URL | node sample-reviews.mjs --out f.jsonl [--lines 300000] [--n 180]
//              [--books ids.txt]   (restrict to these book_ids)
//              [--exclude ids.txt] (drop these book_ids)
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const OUT = arg("--out");
const MAX_LINES = Number(arg("--lines", 300000));
const N = Number(arg("--n", 180));
const only = arg("--books") ? new Set(fs.readFileSync(arg("--books"), "utf8").split("\n").filter(Boolean)) : null;
const excl = arg("--exclude") ? new Set(fs.readFileSync(arg("--exclude"), "utf8").split("\n").filter(Boolean)) : null;

const STOP = new Set("the and of to a in is it that i was for with as on but this be not have are at by or from they he she his her an you my so all one more when there what about which would their if out up can just like had were has been".split(" "));
const words = (t) => (t.match(/\S+/g) || []).length;
function englishy(t) {
  const toks = t.toLowerCase().match(/[a-z']+/g) || [];
  if (toks.length < 40) return false;
  let hits = 0;
  for (const w of toks) if (STOP.has(w)) hits++;
  return hits / toks.length > 0.22;
}

const pools = { low: [], mid: [], high: [] };
const CAP = Number(arg("--pool", 30000)); // per-bucket candidate pool; raise for very large samples
const bucket = (r) => (r <= 2 ? "low" : r === 3 ? "mid" : "high");
// Targets lean toward critical reviews: they name what breaks.
const TARGET = { low: Math.round(N * 0.36), mid: Math.round(N * 0.26), high: N - Math.round(N * 0.36) - Math.round(N * 0.26) };

let seen = 0;
const rl = readline.createInterface({ input: process.stdin.pipe(zlib.createGunzip()), crlfDelay: Infinity });
rl.on("line", (line) => {
  if (++seen > MAX_LINES) {
    rl.close();
    process.stdin.destroy();
    return;
  }
  let r;
  try {
    r = JSON.parse(line);
  } catch {
    return;
  }
  const t = String(r.review_text || "").replace(/\s+/g, " ").trim();
  const w = words(t);
  if (w < 90 || w > 700) return;
  if (!(r.rating >= 1 && r.rating <= 5)) return;
  if (only && !only.has(String(r.book_id))) return;
  if (excl && excl.has(String(r.book_id))) return;
  // Drop reviews that are mostly a spoiler block, or mostly quotes/links.
  if ((t.match(/\(view spoiler\)/g) || []).length > 2) return;
  if ((t.match(/https?:\/\//g) || []).length > 1) return;
  if (!englishy(t)) return;
  const b = pools[bucket(r.rating)];
  const item = { book_id: String(r.book_id), rating: r.rating, votes: Number(r.n_votes) || 0, words: w, text: t.replace(/\(view spoiler\)\[|\(hide spoiler\)\]/g, "") };
  if (b.length < CAP) b.push(item);
  else {
    // keep the pool biased toward helpful reviews
    const i = Math.floor(Math.random() * b.length);
    if (b[i].votes < item.votes) b[i] = item;
  }
});
rl.on("close", finish);
process.stdin.on("error", () => {});

function finish() {
  const out = [];
  for (const k of Object.keys(pools)) {
    const pool = pools[k].sort((a, b) => b.votes + Math.random() * 2 - (a.votes + Math.random() * 2));
    const perBook = new Map();
    let taken = 0;
    for (const it of pool) {
      if (taken >= TARGET[k]) break;
      const c = perBook.get(it.book_id) || 0;
      if (c >= 2) continue;
      perBook.set(it.book_id, c + 1);
      out.push({ ...it, bucket: k });
      taken++;
    }
  }
  // shuffle so the reader doesn't see all 1-stars in a block
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  fs.writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
  const counts = Object.fromEntries(Object.keys(pools).map((k) => [k, { pool: pools[k].length, picked: out.filter((o) => o.bucket === k).length }]));
  console.error(`${OUT}: scanned ${seen} lines → ${out.length} reviews`, JSON.stringify(counts));
  process.exit(0);
}
