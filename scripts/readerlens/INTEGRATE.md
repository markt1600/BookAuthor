# Integrating the Reader Lens into another branch or app

Paste this file (or its link) to the AI working on the other branch. It is
self-contained: it tells the AI what to copy, what each function does, where
to call it, and how to verify the result.

## What this is

The Reader Lens is genre-aware **guidance** (never rules) for an AI novelist,
distilled from 8,330 real reader reviews (UCSD Book Graph of Goodreads). For
each of 7 genres it holds: what readers reward and punish, what they expect,
how they talk about prose, what they say about openings / middles / endings,
and — discovered per genre — the kinds of scene its readers actually discuss
(e.g. erotica: `slow_burn_tease`, `first_consummation`, `aftermath_intimacy`;
mystery: `the_reveal`, `killer_pov`, `courtroom_trial`; romance:
`first_meeting`, `black_moment`, `grovel_reconciliation`). Every line carries
an evidence count. Nothing from any review is ever copied into prose.

## Step 1 — copy two files, unchanged

```
lib/readerlens.js          # the engine: zero dependencies, no app imports, plain ESM
data/reader-lenses.json    # the distilled lenses (version 2 schema)
```

Source (branch `main` of markt1600/BookAuthor):
- https://github.com/markt1600/BookAuthor/blob/main/lib/readerlens.js
- https://github.com/markt1600/BookAuthor/blob/main/data/reader-lenses.json

Do not edit either file in the target branch; they are meant to be replaced
wholesale when a new distillation is run. If the target app cannot import
JSON directly, load it with `fs.readFileSync` + `JSON.parse` instead.

## Step 2 — the engine's API (all pure functions; `lenses` = the parsed JSON)

```js
import { matchGenre, detectPhase, sceneTagInstruction, parseSceneTags, lensBlock, rubricBlock } from "./lib/readerlens.js";

// Which lens applies. `label` is a free-text genre ("Cozy mystery"); opts are
// optional steering flags. Explicit flags win over the label; specialty genres
// win over the general fallback; unknown labels fall back to "general".
const key = matchGenre(lenses, genreLabel, { style, adult, erotica, sexual });

// Where the writing stands: "opening" | "middle" | "ending".
// Chapter 1 with ≤2 sections → opening; a direction that mentions the climax,
// ending, epilogue, etc. → ending; isFirst / isLast / ended override.
const phase = detectPhase({ chapterNum, sections, direction, ended, isFirst, isLast });

// For the PLANNER (if the app plans before drafting): one line telling it to end
// its plan with  SCENES: key, key  chosen from THIS genre's scene kinds.
const sceneLine = sceneTagInstruction(lenses, key);

// After planning: the scene keys the planner tagged (≤2). Falls back to matching
// label words in the plan when the tag line is missing.
const scenes = parseSceneTags(planText, lenses, key);

// For the WRITER: ~2,000 chars max. Situational guidance first (phase, then the
// tagged scenes), then the genre's general reward/punish/expectation/prose notes.
const writerBlock = lensBlock(lenses, { genre: key, phase, scenes });

// For the CRITIC / analyzer / revision planner: ~1,200 chars max.
const criticBlock = rubricBlock(lenses, key);
```

## Step 3 — where to put each block in the prompts

- **Writer prompts** (every call that generates narrative, in every mode,
  including regenerate): append `writerBlock` to the user message, after the
  continuity/context material and before the instruction for the section.
  Place it OUTSIDE any cached prefix (it varies per section).
- **Planner prompt** (if the app has a plan-then-write step): include a
  shorter lens (`lensBlock(lenses, { genre: key, phase, scenes: [], maxChars: 1200 })`)
  in the user message, and add `sceneLine` to the planner's rules. Then run
  `parseSceneTags` on the plan and pass the result into the writer's lens.
  Without a planner, call `lensBlock` with `scenes: []` — phase guidance still applies.
- **Analyzer / critique / score**: add `criticBlock` to the system prompt with a
  sentence like: *"Use this lens as one input to the score, critique, and
  suggestions — the readers' expectations alongside your own judgment of
  craft; it is guidance about how the book will land, not a checklist."*
- **Revision passes**: pass `lensBlock` with `isFirst`/`isLast` → phase so the
  first part gets opening guidance and the last part gets ending guidance.

## Step 4 — guardrails to preserve

- Keep the framing as **guidance**. The engine's own header says "NOT rules —
  deviate when the story calls for it, but deviate on purpose." Do not rewrite
  the blocks into imperative rules or checklists.
- Never surface review text to the reader or copy lens lines into prose.
- Erotica: `matchGenre` returns `erotica` when the book's own settings say so
  (`erotica: true`, or adult with explicitness at max) regardless of the label.
  Only route there when the app's maturity settings permit explicit content.
- Keep the writer block ≤ ~2,000 characters (the default); the function clips
  the generic tail, never the situational head.

## Step 5 — verify

1. `node --check --input-type=module < lib/readerlens.js` parses.
2. In a scratch script: `matchGenre(lenses, "Psychological thriller")` →
   `mystery_thriller_crime`; `matchGenre(lenses, "Literary horror")` →
   `fantasy_paranormal`; `matchGenre(lenses, "Something unknown")` → `general`.
3. `lensBlock(lenses, { genre: "erotica", phase: "ending", scenes: ["aftermath_intimacy"] })`
   returns text containing both "Approaching the ENDING" and "For ".
4. Generate one section and confirm the plan ends with a `SCENES:` line whose
   keys exist in that genre's `scenes` object, and that the writer prompt
   contains the matching "For …:" block.

## Reference glue (how the source branch wires it — ~40 lines in lib/generate.js)

```js
import lensData from "@/data/reader-lenses.json";
import { matchGenre, detectPhase, parseSceneTags, lensBlock, rubricBlock, sceneTagInstruction } from "@/lib/readerlens";

export function lensKeyFor(book) {
  const g = book.guide || {};
  return matchGenre(lensData, book.analysis && book.analysis.genre, { style: g.style, adult: g.adult, erotica: g.erotica, sexual: g.sexual });
}
export function lensForSection(book, { direction = "", plan = "", isFirst = false, isLast = false } = {}) {
  const key = lensKeyFor(book);
  if (!key) return "";
  const phase = detectPhase({ chapterNum: currentChapterNum(book), sections: sectionCount(book), direction, isFirst, isLast });
  return lensBlock(lensData, { genre: key, phase, scenes: parseSceneTags(plan, lensData, key) });
}
export function plannerLens(book, { direction = "" } = {}) {
  const key = lensKeyFor(book);
  if (!key) return { lens: "", sceneInstruction: "" };
  const phase = detectPhase({ chapterNum: currentChapterNum(book), sections: sectionCount(book), direction });
  return { lens: lensBlock(lensData, { genre: key, phase, scenes: [], maxChars: 1200 }), sceneInstruction: sceneTagInstruction(lensData, key) };
}
export function rubricFor(book) {
  const key = lensKeyFor(book);
  return key ? rubricBlock(lensData, key) : "";
}
```

## Rebuilding the data at larger scale

See `scripts/readerlens/README.md`. The scripts sample the review dumps,
distill with the Claude API (resumable), assemble `data/reader-lenses.json`,
and regenerate the human-readable report `data/reader-lenses.md`. Another
branch only needs the two files from Step 1; the scripts stay here.
