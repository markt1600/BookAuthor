#!/usr/bin/env node
// Assemble data/reader-lenses.json from per-genre lens files (the output of the
// reducer step — or of build-lenses.mjs). Normalizes every lens through the
// engine so the stored shape is always what lib/readerlens.js expects.
//
//   node scripts/readerlens/assemble.mjs <dir-of-lens-json> [--out data/reader-lenses.json] [--source "..."]
import fs from "node:fs";
import path from "node:path";
import { normalizeLens } from "../../lib/readerlens.js";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const dir = process.argv[2];
if (!dir) {
  console.error("usage: assemble.mjs <dir> [--out file] [--source text]");
  process.exit(1);
}
const out = arg("--out", "data/reader-lenses.json");
const source = arg("--source", "UCSD Book Graph (Goodreads reviews, Wan & McAuley) — sampled, balanced across star ratings, weighted by helpful votes, distilled");

const lenses = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const key = path.basename(f, ".json");
  const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  lenses[key] = normalizeLens(raw, { key, label: raw.label, aliases: raw.aliases, reviews: raw.reviews });
  const sc = Object.keys(lenses[key].scenes);
  console.error(`${key}: ${lenses[key].reviews} reviews · ${lenses[key].reward.length} reward · ${lenses[key].punish.length} punish · scenes: ${sc.join(", ") || "(none)"}`);
}
const doc = { version: 2, updatedAt: new Date().toISOString().slice(0, 10), source, lenses };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.error(`wrote ${out} (${Object.keys(lenses).length} lenses)`);
