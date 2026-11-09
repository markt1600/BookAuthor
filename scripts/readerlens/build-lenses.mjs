#!/usr/bin/env node
// Distill reader lenses from review samples with the Claude API — the
// automated, large-scale path (e.g. 10,000 reviews per genre). Uses the
// engine's own map-reduce (lib/readerlens.js): batches of reviews → structured
// observations with evidence counts and discovered scene kinds → merged →
// composed into one lens per genre. Then assemble + report.
//
//   ANTHROPIC_API_KEY=... node scripts/readerlens/build-lenses.mjs \
//       --samples samples_10k --out build/lenses [--genres erotica,romance] \
//       [--model claude-sonnet-5] [--batch 40] [--concurrency 6]
//
// Inputs: <samples>/<genre>.jsonl from sample-reviews.mjs. Writes one lens
// JSON per genre to <out>/, resumable: finished genres are skipped. Then run
//   node scripts/readerlens/assemble.mjs build/lenses
//   node scripts/readerlens/report.mjs
//
// Cost guide (Sonnet 5, $2/$10 per MTok): a 10k-review genre is ~250 batches of
// 40 reviews (~15k tokens each) ≈ 3.75M input tokens ≈ $8 + output ≈ $10-12
// per genre; 7 genres ≈ $70-85. Opus 5 is ~2.5× that.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { batchPrompt, parseObservations, mergeObservations, composePrompt, normalizeLens } from "../../lib/readerlens.js";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const SAMPLES = arg("--samples", "samples");
const OUT = arg("--out", "build/lenses");
const MODEL = arg("--model", process.env.CLAUDE_ANALYSIS_MODEL || "claude-sonnet-5");
const BATCH = Number(arg("--batch", 40));
const CONC = Number(arg("--concurrency", 6));
const only = arg("--genres") ? new Set(arg("--genres").split(",").map((s) => s.trim())) : null;

// Labels and alias lists for the lens keys (the genre keys are the file names).
const META = {
  general: { label: "General & literary fiction", aliases: ["literary", "literary fiction", "contemporary fiction", "general fiction", "fiction", "drama", "family saga", "domestic", "magical realism", "satire", "humor", "tragicomedy", "slice of life", "upmarket", "novel", "literary thriller"] },
  mystery_thriller_crime: { label: "Mystery, thriller & crime", aliases: ["mystery", "thriller", "crime", "noir", "detective", "suspense", "police procedural", "whodunit", "spy", "espionage", "legal thriller", "psychological thriller", "hardboiled", "cozy mystery", "heist"] },
  fantasy_paranormal: { label: "Fantasy, paranormal & speculative", aliases: ["fantasy", "paranormal", "urban fantasy", "epic fantasy", "high fantasy", "science fiction", "sci-fi", "speculative", "dystopian", "horror", "supernatural", "vampire", "werewolf", "fairy tale", "mythic", "space opera", "post-apocalyptic", "grimdark", "sword and sorcery"] },
  romance: { label: "Romance", aliases: ["romance", "romantic", "love story", "romantic comedy", "rom-com", "contemporary romance", "historical romance", "paranormal romance", "regency", "second chance", "enemies to lovers", "slow burn", "romantic suspense", "chick lit", "women's fiction"] },
  erotica: { label: "Erotica & erotic romance", aliases: ["erotica", "erotic", "erotic romance", "bdsm", "kink", "steamy", "explicit romance", "adult romance", "smut", "dark romance"] },
  historical: { label: "Historical fiction", aliases: ["historical", "historical fiction", "period", "wartime", "world war", "ww2", "wwii", "victorian", "medieval", "tudor", "ancient", "biographical fiction", "saga", "civil war", "colonial", "dual timeline"] },
  young_adult: { label: "Young adult", aliases: ["young adult", "ya", "teen", "coming-of-age", "coming of age", "high school", "new adult", "middle grade"] },
};

const client = new Anthropic();
async function complete(text, maxTokens = 6000) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: text }],
  });
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(SAMPLES).filter((f) => f.endsWith(".jsonl") && !/\.part\d+\.jsonl$/.test(f));
for (const f of files) {
  const key = path.basename(f, ".jsonl");
  if (only && !only.has(key)) continue;
  const outFile = path.join(OUT, `${key}.json`);
  if (fs.existsSync(outFile)) {
    console.error(`${key}: already built — skipping`);
    continue;
  }
  const reviews = fs
    .readFileSync(path.join(SAMPLES, f), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const meta = META[key] || { label: key, aliases: [] };
  const batches = [];
  for (let i = 0; i < reviews.length; i += BATCH) batches.push(reviews.slice(i, i + BATCH));
  console.error(`${key}: ${reviews.length} reviews → ${batches.length} batches on ${MODEL}`);

  // Map (resumable per batch).
  const obsDir = path.join(OUT, `${key}.obs`);
  fs.mkdirSync(obsDir, { recursive: true });
  const observations = await pool(batches, CONC, async (b, i) => {
    const cache = path.join(obsDir, `${String(i).padStart(4, "0")}.json`);
    if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const obs = parseObservations(await complete(batchPrompt({ genre: key, label: meta.label, reviews: b })));
        if (obs) {
          fs.writeFileSync(cache, JSON.stringify(obs));
          if ((i + 1) % 10 === 0) console.error(`  ${key}: batch ${i + 1}/${batches.length}`);
          return obs;
        }
      } catch (err) {
        console.error(`  ${key}: batch ${i} failed (${attempt + 1}/3): ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    return null;
  });

  // Reduce + compose.
  const merged = mergeObservations(observations.filter(Boolean));
  const composed = await complete(composePrompt({ genre: key, label: meta.label, merged, reviews: reviews.length }), 8000);
  const lens = normalizeLens(composed, { key, label: meta.label, aliases: meta.aliases, reviews: reviews.length });
  fs.writeFileSync(outFile, JSON.stringify(lens, null, 2));
  console.error(`${key}: wrote ${outFile} · scenes: ${Object.keys(lens.scenes).join(", ")}`);
}
console.error("done. Next: node scripts/readerlens/assemble.mjs " + OUT + " && node scripts/readerlens/report.mjs");
