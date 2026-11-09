// Stream a gzipped JSONL of Goodreads BOOKS on stdin; print book_ids whose
// popular shelves match a pattern strongly enough. Usage:
//   curl URL | node shelf-ids.mjs --match 'erotica|erotic' [--min 25] [--top 12] [--lines 400000] > ids.txt
// A book qualifies when a matching shelf appears within its top `--top`
// shelves with at least `--min` shelvings and the book has enough ratings.
import zlib from "node:zlib";
import readline from "node:readline";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const re = new RegExp(`^(${arg("--match")})$`, "i");
const MIN = Number(arg("--min", 25));
const TOP = Number(arg("--top", 12));
const MAX_LINES = Number(arg("--lines", 400000));
const MIN_RATINGS = Number(arg("--ratings", 200));

let seen = 0;
let hits = 0;
const rl = readline.createInterface({ input: process.stdin.pipe(zlib.createGunzip()), crlfDelay: Infinity });
rl.on("line", (line) => {
  if (++seen > MAX_LINES) {
    rl.close();
    process.stdin.destroy();
    return;
  }
  let b;
  try {
    b = JSON.parse(line);
  } catch {
    return;
  }
  if ((Number(b.ratings_count) || 0) < MIN_RATINGS) return;
  const shelves = (b.popular_shelves || []).slice(0, TOP);
  if (shelves.some((s) => re.test(String(s.name || "")) && (Number(s.count) || 0) >= MIN)) {
    hits++;
    process.stdout.write(`${b.book_id}\n`);
  }
});
rl.on("close", () => {
  console.error(`shelf-ids: scanned ${seen} books → ${hits} matched`);
  process.exit(0);
});
process.stdin.on("error", () => {});
