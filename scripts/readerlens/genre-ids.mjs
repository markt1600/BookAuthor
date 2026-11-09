// Stream goodreads_book_genres_initial.json.gz (gz on stdin); print book_ids of
// GENERAL / LITERARY fiction: "fiction" is the dominant shelf-genre and no
// specialty genre comes close. Usage: curl URL | node genre-ids.mjs > ids.txt
import zlib from "node:zlib";
import readline from "node:readline";

const SPECIAL = ["fantasy, paranormal", "romance", "mystery, thriller, crime", "young-adult", "children", "comics, graphic", "poetry", "history, historical fiction, biography", "non-fiction"];
let seen = 0;
let hits = 0;
const rl = readline.createInterface({ input: process.stdin.pipe(zlib.createGunzip()), crlfDelay: Infinity });
rl.on("line", (line) => {
  seen++;
  let b;
  try {
    b = JSON.parse(line);
  } catch {
    return;
  }
  const g = b.genres || {};
  const fic = Number(g.fiction) || 0;
  if (fic < 15) return;
  const maxSpecial = Math.max(0, ...SPECIAL.map((k) => Number(g[k]) || 0));
  if (fic >= 2.5 * maxSpecial) {
    hits++;
    process.stdout.write(`${b.book_id}\n`);
  }
});
rl.on("close", () => {
  console.error(`genre-ids: scanned ${seen} books → ${hits} general-fiction ids`);
});
