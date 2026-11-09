#!/usr/bin/env node
// Render data/reader-lenses.json as a readable Markdown report: for each genre,
// the generalised guidance (what readers reward / punish / expect, prose notes),
// where-in-the-book guidance, and the genre-specific scene kinds with their
// guidance. Regenerate after every distillation run.
//
//   node scripts/readerlens/report.mjs [--in data/reader-lenses.json] [--out data/reader-lenses.md]
import fs from "node:fs";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const inFile = arg("--in", "data/reader-lenses.json");
const outFile = arg("--out", "data/reader-lenses.md");
const doc = JSON.parse(fs.readFileSync(inFile, "utf8"));

const li = (arr) => (arr || []).map((x) => `- ${x.t}  _(${x.n})_`).join("\n") || "_(none evidenced)_";
const total = Object.values(doc.lenses).reduce((a, l) => a + (l.reviews || 0), 0);

const lines = [];
lines.push(`# Reader Lens — what readers reward and punish, by genre`);
lines.push("");
lines.push(`_Generated ${doc.updatedAt} from **${total.toLocaleString()}** reader reviews. Source: ${doc.source}._`);
lines.push("");
lines.push(
  "Every line below is **guidance, not a rule**: it describes what readers of a genre reward or punish in their own reviews, so the AI author can deviate deliberately rather than by accident. The number after each line is the evidence count — how many reviews in the sample supported it. Scene kinds are **specific to each genre**, discovered from what its readers actually discuss; the planner tags each section with one or two of them and the writer receives that scene's guidance."
);
lines.push("");
lines.push("## Contents");
for (const [k, l] of Object.entries(doc.lenses)) lines.push(`- [${l.label}](#${k.replace(/_/g, "-")}) — ${(l.reviews || 0).toLocaleString()} reviews · ${Object.keys(l.scenes || {}).length} scene kinds`);
lines.push("");

for (const [k, l] of Object.entries(doc.lenses)) {
  lines.push(`## ${l.label}`);
  lines.push(`<a id="${k.replace(/_/g, "-")}"></a>`);
  lines.push("");
  lines.push(`**Key:** \`${k}\` · **Reviews:** ${(l.reviews || 0).toLocaleString()} · **Matches genre labels like:** ${(l.aliases || []).slice(0, 10).join(", ")}${(l.aliases || []).length > 10 ? ", …" : ""}`);
  lines.push("");
  lines.push("### Generalised guidance");
  lines.push("");
  lines.push("**Readers reward**");
  lines.push(li(l.reward));
  lines.push("");
  lines.push("**Readers punish**");
  lines.push(li(l.punish));
  lines.push("");
  lines.push("**They come in expecting**");
  lines.push(li(l.expectations));
  lines.push("");
  lines.push("**On the prose itself**");
  lines.push(li(l.prose));
  lines.push("");
  lines.push("### Where in the book");
  lines.push("");
  for (const p of ["opening", "middle", "ending"]) {
    lines.push(`**${p[0].toUpperCase() + p.slice(1)}**`);
    lines.push(li(l.phases && l.phases[p]));
    lines.push("");
  }
  lines.push("### Scene kinds (genre-specific sub-prompts)");
  lines.push("");
  const scenes = Object.entries(l.scenes || {});
  if (!scenes.length) lines.push("_(no scene kinds evidenced)_");
  for (const [sk, s] of scenes) {
    lines.push(`**${s.label}** \`${sk}\``);
    lines.push(li(s.items));
    lines.push("");
  }
  if (l.voices && l.voices.length) {
    lines.push("### In readers' own words (paraphrased)");
    lines.push("");
    lines.push(l.voices.map((v) => `> “${v.t}”`).join("\n>\n"));
    lines.push("");
  }
  if (l.notes) {
    lines.push(`_Sample notes: ${l.notes}_`);
    lines.push("");
  }
}
fs.writeFileSync(outFile, lines.join("\n"));
console.error(`wrote ${outFile}`);
