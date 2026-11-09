# Reader Lens — distilling reader reviews into genre guidance

The Reader Lens turns large numbers of real reader reviews into compact,
genre-aware **guidance** (never rules) for the AI author: what readers of a
genre reward and punish, what they expect, how they talk about prose, what they
say about openings / middles / endings, and — discovered per genre — the kinds
of scene they actually discuss (kinds of intimate scene for erotica; chases,
interrogations, reveals for thrillers; the meet and the black moment for
romance…). The planner tags each section with one or two of its genre's scene
kinds, and the writer receives that scene's guidance alongside the genre and
where-in-the-book guidance. The critic gets the same knowledge as a rubric.

## Portable engine — two files

- `lib/readerlens.js` — zero-dependency engine. No imports from the app; the
  model is reached only through an injected `complete(text)`.
- `data/reader-lenses.json` — the distilled lenses (one per genre).

To adopt in another branch: copy both files, then call `matchGenre`,
`detectPhase`, `parseSceneTags`, `lensBlock`, `rubricBlock`, and
`sceneTagInstruction` where that branch builds its prompts (see
`lib/generate.js` here for the ~40-line glue: `lensKeyFor`, `lensForSection`,
`plannerLens`, `rubricFor`).

## Data source

The **UCSD Book Graph** (Mengting Wan & Julian McAuley): ~15.7M Goodreads
reviews, released for academic research — fine for a personal app; not licensed
for commercial redistribution. Goodreads has had no public API since 2020 and
scraping it violates its terms, so this dataset is the legitimate route.
Samples are balanced across star ratings (weighted toward critical reviews,
which name what breaks), weighted by helpful votes, filtered for length and
language, capped at two reviews per book. Nothing from any review is ever
copied into prose.

## Rebuilding at scale (e.g. 10,000 reviews per genre)

```bash
# 1. Sample (streams ~8 GB of gzipped dumps; keeps only the samples)
bash scripts/readerlens/run-sampling.sh 10000 samples_10k

# 2. Distill with the Claude API (resumable; ~$10-12 per genre on Sonnet 5)
ANTHROPIC_API_KEY=sk-... node scripts/readerlens/build-lenses.mjs --samples samples_10k --out build/lenses

# 3. Assemble into the data file and regenerate the report
node scripts/readerlens/assemble.mjs build/lenses
node scripts/readerlens/report.mjs
```

The current `data/reader-lenses.json` was distilled from ~1,190 reviews per
genre by Claude agents reading the samples directly (a 250-review map step per
agent, then a reduce step per genre), with the same schema the script produces.
