// Reader Lens — a standalone engine that turns large numbers of reader reviews
// into compact, genre-aware GUIDANCE for an AI novelist, and renders that
// guidance for prompts. Zero dependencies and no imports from the rest of the
// app, so this file (plus data/reader-lenses.json) can be dropped into any
// branch. The model is reached only through an injected `complete(text)`.
//
//   lenses = JSON from data/reader-lenses.json  (built by scripts/readerlens/)
//   key    = matchGenre(lenses, book.analysis.genre, { style, adult, erotica })
//   phase  = detectPhase({ chapterNum, sections, direction, ended, isFirst, isLast })
//   scenes = parseSceneTags(beatPlan, lenses, key)      // this genre's scene kinds
//   lensBlock(lenses, { genre: key, phase, scenes })    → text for the writer
//   rubricBlock(lenses, key)                            → text for the critic
//   sceneTagInstruction(lenses, key)                    → one line for the planner
//
// Everything here is GUIDANCE, not rules: it describes what readers of a genre
// reward and punish, so the writer can deviate deliberately rather than by
// accident. Nothing from any review is ever copied into prose — the lens holds
// distilled patterns and a few short paraphrased reader phrases.
//
// Scenes are GENRE-SPECIFIC: each lens carries its own taxonomy of the set
// pieces its readers actually discuss (an erotica lens has kinds of intimate
// scene; a thriller lens has chases, interrogations, reveals), discovered from
// the reviews rather than imposed. Keys are snake_case; each kind has a label.

export const PHASES = ["opening", "middle", "ending"];

// ---- Lookup ----------------------------------------------------------------

// Map the analyzer's free-text genre label (plus the book's guide settings) to
// a lens key. Explicit signals win: an erotica book is erotica whatever the
// label says; a Burdett-style book is crime noir. Falls back to "general".
export function matchGenre(lenses, label, opts = {}) {
  const keys = Object.keys((lenses && lenses.lenses) || {});
  if (!keys.length) return "";
  const has = (k) => keys.includes(k);
  if (opts.erotica && has("erotica")) return "erotica";
  if (opts.style === "burdett" && has("mystery_thriller_crime")) return "mystery_thriller_crime";
  const l = String(label || "").toLowerCase();
  if (l) {
    // Specialty lenses win over the general fallback whenever any of their
    // aliases matches ("literary horror" is horror); among specialties, the
    // longest alias wins ("paranormal romance" is romance, not paranormal).
    let best = "";
    let bestLen = 0;
    for (const k of keys) {
      if (k === "general") continue;
      const aliases = [k.replace(/_/g, " "), ...(lenses.lenses[k].aliases || [])];
      for (const a of aliases) {
        const al = String(a).toLowerCase();
        if (al && l.includes(al) && al.length > bestLen) {
          best = k;
          bestLen = al.length;
        }
      }
    }
    if (best) return best;
  }
  if (opts.adult && Number(opts.sexual) >= 3 && has("erotica")) return "erotica";
  return has("general") ? "general" : keys[0];
}

const ENDING_WORDS =
  /\b(final (?:chapter|scene|section|confrontation|battle|showdown)|ending|the end|climax|climactic|resolution|resolve[sd]? (?:the|everything|it all)|epilogue|denouement|last chapter|wrap(?:s|ping)? up|bring (?:it|the story|everything) to a close|conclude|aftermath)\b/i;

// Where the writing stands in the book's arc. Explicit flags (a revision
// pass's first/last part, an ended book) win; then chapter position; then the
// director's own words — an instruction that asks for the climax or the
// ending gets the ending guidance even mid-manuscript.
export function detectPhase({ chapterNum = 1, sections = 0, direction = "", ended = false, isFirst = false, isLast = false } = {}) {
  if (isFirst) return "opening";
  if (isLast || ended) return "ending";
  if (ENDING_WORDS.test(String(direction || ""))) return "ending";
  if (chapterNum <= 1 && sections <= 2) return "opening";
  return "middle";
}

function getLens(lenses, genre) {
  const l = lenses && lenses.lenses && lenses.lenses[genre];
  return l || (lenses && lenses.lenses && lenses.lenses.general) || null;
}

// This genre's scene kinds: [{ key, label }].
export function sceneKinds(lenses, genre) {
  const L = getLens(lenses, genre);
  const s = (L && L.scenes) || {};
  return Object.keys(s).map((key) => ({ key, label: (s[key] && s[key].label) || key.replace(/_/g, " ") }));
}

// A one-line instruction for the planner so it tags the scene kinds using
// THIS genre's taxonomy. Empty when the lens has no scenes.
export function sceneTagInstruction(lenses, genre) {
  const kinds = sceneKinds(lenses, genre);
  if (!kinds.length) return "";
  return (
    `End the plan with one final line "SCENES: key, key" naming the one or two kinds of scene this section mostly is, choosing ONLY from these keys (or "none" if none fits): ` +
    kinds.map((k) => `${k.key} (${k.label})`).join("; ") +
    "."
  );
}

// Parse the planner's "SCENES: a, b" line against this genre's kinds; fall
// back to matching label words in the plan so guidance still applies when the
// tag line is missing. Returns up to two keys.
export function parseSceneTags(planText, lenses, genre) {
  const kinds = sceneKinds(lenses, genre);
  if (!kinds.length) return [];
  const t = String(planText || "");
  const out = [];
  const m = t.match(/^\s*SCENES?\s*:\s*(.+)$/im);
  if (m) {
    for (const raw of m[1].split(/[,/;&]|\band\b/)) {
      const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
      if (!k || k === "none") continue;
      const hit = kinds.find((s) => s.key === k || s.key.startsWith(k) || k.startsWith(s.key));
      if (hit && !out.includes(hit.key)) out.push(hit.key);
    }
  }
  if (!out.length) {
    const low = t.toLowerCase();
    for (const s of kinds) {
      const words = s.label
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length > 4 && !/^(scene|scenes|moment|their|where|which|about)$/.test(w));
      if (words.some((w) => low.includes(w))) out.push(s.key);
      if (out.length >= 2) break;
    }
  }
  return out.slice(0, 2);
}

// ---- Rendering ---------------------------------------------------------------

// Items are { t: "guidance line", n: evidence count } (or plain strings).
function items(list, max) {
  return (Array.isArray(list) ? list : [])
    .map((x) => (typeof x === "string" ? { t: x, n: 1 } : x))
    .filter((x) => x && typeof x.t === "string" && x.t.trim())
    .sort((a, b) => (Number(b.n) || 0) - (Number(a.n) || 0))
    .slice(0, max)
    .map((x) => x.t.trim());
}
const bullets = (arr) => arr.map((t) => `- ${t}`).join("\n");

// The writer's block. The most situational guidance comes FIRST — where in the
// book, then the kinds of scene this section is about to be — followed by the
// genre's general reward/punish/expectation/prose notes, so that if anything
// is clipped for length it is the generic tail, never the sub-prompts.
export function lensBlock(lenses, { genre, phase = "middle", scenes = [], maxChars = 2000 } = {}) {
  const L = getLens(lenses, genre);
  if (!L) return "";
  const parts = [
    `Reader lens — ${L.label || genre} (guidance distilled from ${L.reviews || "many"} reader reviews; it describes what readers reward and punish, NOT rules — deviate when the story calls for it, but deviate on purpose):`,
  ];
  const ph = L.phases && items(L.phases[phase], 3);
  if (ph && ph.length) {
    const where = phase === "opening" ? "At the OPENING of a book" : phase === "ending" ? "Approaching the ENDING" : "In the MIDDLE of a book";
    parts.push(`${where}, readers of this genre say:\n${bullets(ph)}`);
  }
  for (const key of scenes || []) {
    const sc = L.scenes && L.scenes[key];
    const lines = sc && items(sc.items, 3);
    if (lines && lines.length) parts.push(`For ${sc.label || key.replace(/_/g, " ")}:\n${bullets(lines)}`);
  }
  const reward = items(L.reward, 3);
  const punish = items(L.punish, 3);
  const expect = items(L.expectations, 2);
  const prose = items(L.prose, 2);
  if (reward.length) parts.push(`Readers reward:\n${bullets(reward)}`);
  if (punish.length) parts.push(`Readers punish:\n${bullets(punish)}`);
  if (expect.length) parts.push(`They come in expecting:\n${bullets(expect)}`);
  if (prose.length) parts.push(`On the prose itself:\n${bullets(prose)}`);
  return clip(parts.join("\n"), maxChars);
}

// The critic's block: the same knowledge, framed as what to weigh when judging.
export function rubricBlock(lenses, genre, { maxChars = 1200 } = {}) {
  const L = getLens(lenses, genre);
  if (!L) return "";
  const reward = items(L.reward, 4);
  const punish = items(L.punish, 5);
  const voices = items(L.voices, 4);
  const parts = [
    `Reader lens for ${L.label || genre} (distilled from ${L.reviews || "many"} reader reviews). When judging and critiquing, weigh how this book would land on THESE readers, alongside craft:`,
  ];
  if (reward.length) parts.push(`They reward:\n${bullets(reward)}`);
  if (punish.length) parts.push(`They punish:\n${bullets(punish)}`);
  if (voices.length) parts.push(`In their own words (paraphrased): ${voices.map((v) => `“${v}”`).join(" · ")}`);
  return clip(parts.join("\n"), maxChars);
}

function clip(text, max) {
  const t = String(text || "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  return (nl > max * 0.6 ? cut.slice(0, nl) : cut).trim();
}

// ---- Distillation (needs a model: `complete(text) -> Promise<string>`) --------
// A map-reduce over reviews. Each batch yields structured observations,
// including the kinds of scene those reviews discuss; observations merge by
// count; a final pass composes the lens and consolidates the scene taxonomy.

const LIST_KEYS = ["reward", "punish", "expectations", "prose", "opening", "middle", "ending", "voices"];

export function batchPrompt({ genre, label, reviews }) {
  const body = reviews
    .map((r, i) => `#${i + 1} [${r.rating}★${r.votes ? `, ${r.votes} helpful votes` : ""}]\n${String(r.text).slice(0, 2200)}`)
    .join("\n\n");
  return [
    `You are distilling what makes a good read for readers of ${label || genre}, from their own reviews. Read the ${reviews.length} reviews below and extract ONLY patterns that the reviews themselves evidence — not general craft advice.`,
    'Respond with a single JSON object and nothing else. List keys are arrays of {"t": guidance line, "n": how many of these reviews support it}:',
    '  "reward": what readers praise (pacing, character, stakes, voice, emotional payoff, humor, atmosphere...). Phrase each as a short guidance line FOR A WRITER (under 150 characters).',
    '  "punish": what readers complain about, phrased the same way as cautions.',
    '  "expectations": genre norms readers clearly carry in (what they feel entitled to, what counts as cheating).',
    '  "prose": sentence/dialogue-level notes readers actually make (purple vs plain, dialogue that sounds spoken, repetition, telling vs showing, info-dumps).',
    '  "opening", "middle", "ending": what readers say about THAT part of a book — slow starts, saggy middles, rushed or unearned endings, cliffhangers, epilogues.',
    '  "scenes": an ARRAY of the KINDS OF SCENE these readers actually discuss — the recurring set pieces of this genre (e.g. kinds of intimate scene for erotica; chases, interrogations, reveals for thrillers; the meet, the black moment for romance). Each: {"key": "snake_case", "label": "plain label", "items": [{"t","n"}]}. Only kinds that recur across reviews; 2-6 kinds; 1-4 items each.',
    '  "voices": 3-6 short, representative reader phrases (under 12 words each, lightly paraphrased, no names or titles).',
    "Rules: only include an item when at least 2 reviews support it (n ≥ 2), except voices. Be concrete and specific to this genre. No markdown, no commentary.",
    "",
    "REVIEWS:",
    body,
  ].join("\n");
}

const cleanItems = (arr, cap = 220) =>
  (Array.isArray(arr) ? arr : [])
    .map((x) => (typeof x === "string" ? { t: x, n: 1 } : x))
    .filter((x) => x && typeof x.t === "string" && x.t.trim())
    .map((x) => ({ t: x.t.trim().slice(0, cap), n: Math.max(1, Math.round(Number(x.n) || 1)) }));

const sceneKey = (k) =>
  String(k || "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40);

export function parseObservations(raw) {
  const obj = parseLoose(raw);
  if (!obj) return null;
  const out = {};
  for (const k of LIST_KEYS) out[k] = cleanItems(obj[k]);
  out.scenes = (Array.isArray(obj.scenes) ? obj.scenes : [])
    .filter((s) => s && (s.key || s.label))
    .map((s) => ({ key: sceneKey(s.key || s.label), label: String(s.label || s.key).trim().slice(0, 60), items: cleanItems(s.items) }))
    .filter((s) => s.key && s.items.length);
  return out;
}

// Merge observation sets by near-duplicate text (cheap normalization), summing n.
// Scene kinds merge by key (or by label overlap).
export function mergeObservations(list) {
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(the|a|an|and|or|of|to|in|that|is|are|be|it|its|their|they|readers?|when|with|for)\b/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 3)
      .slice(0, 4)
      .join(" ");
  const mergeList = (lists) => {
    const map = new Map();
    for (const arr of lists) {
      for (const it of arr || []) {
        const key = norm(it.t);
        if (!key) continue;
        const cur = map.get(key);
        if (cur) {
          cur.n += it.n;
          if (it.t.length < cur.t.length) cur.t = it.t; // keep the tighter phrasing
        } else map.set(key, { t: it.t, n: it.n });
      }
    }
    return [...map.values()].sort((a, b) => b.n - a.n);
  };
  const merged = {};
  for (const k of LIST_KEYS) merged[k] = mergeList(list.map((o) => o && o[k]));
  // scenes: group by key, then by shared label words
  const groups = new Map();
  for (const obs of list) {
    for (const s of (obs && obs.scenes) || []) {
      let gk = s.key;
      if (!groups.has(gk)) {
        const sw = new Set(s.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4));
        for (const [k, g] of groups) {
          const gw = g.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
          if (gw.some((w) => sw.has(w))) {
            gk = k;
            break;
          }
        }
      }
      const g = groups.get(gk) || { key: gk, label: s.label, items: [], mappers: 0 };
      g.items.push(s.items);
      g.mappers += 1;
      groups.set(gk, g);
    }
  }
  merged.scenes = [...groups.values()]
    .map((g) => ({ key: g.key, label: g.label, mappers: g.mappers, items: mergeList(g.items) }))
    .sort((a, b) => b.mappers - a.mappers || b.items.reduce((x, y) => x + y.n, 0) - a.items.reduce((x, y) => x + y.n, 0));
  return merged;
}

export function composePrompt({ genre, label, merged, reviews }) {
  const show = (arr, max) => (arr || []).slice(0, max).map((x) => `- (${x.n}) ${x.t}`).join("\n") || "(none)";
  const scenes = (merged.scenes || [])
    .map((s) => `${s.key} — "${s.label}" (seen by ${s.mappers} batch${s.mappers === 1 ? "" : "es"}):\n${show(s.items, 8)}`)
    .join("\n\n");
  return [
    `You are writing the final "reader lens" for ${label || genre}: compact guidance for an AI novelist, distilled from ${reviews} reader reviews. Below are merged observations with evidence counts (how many reviews supported each).`,
    'Produce a single JSON object and nothing else, with these keys; list items are {"t": line, "n": evidence count}:',
    `"reward" (5-7), "punish" (5-7), "expectations" (3-5), "prose" (3-5), "phases": {"opening": [3-5], "middle": [3-5], "ending": [3-5]}, "scenes": an OBJECT keyed by snake_case scene kind → {"label": plain label, "items": [2-5]}, "voices" (6-8 short reader phrases under 12 words).`,
    "SCENES: consolidate the batch-level scene kinds into THIS genre's taxonomy — merge overlapping kinds, keep the 4-8 that recur across batches and would commonly occur in a novel of this genre, drop one-off kinds. Keys snake_case; labels plain.",
    "Rules: merge overlapping observations, keep the most evidenced, keep each line under 150 characters, written as GUIDANCE about what readers reward/punish (not commands — deviation must stay possible). Carry evidence counts (sum merged ones). Specific to this genre; no generic craft advice; no markdown.",
    "",
    ...LIST_KEYS.map((k) => `${k.toUpperCase()}:\n${show(merged[k], k === "voices" ? 12 : 18)}`),
    `SCENE KINDS FROM THE BATCHES:\n${scenes || "(none)"}`,
  ].join("\n\n");
}

// Normalize a composed lens into the stored shape and cap everything.
export function normalizeLens(raw, { key, label, aliases = [], reviews = 0 } = {}) {
  const obj = (typeof raw === "string" ? parseLoose(raw) : raw) || {};
  const arr = (x, max, cap = 180) =>
    cleanItems(x, cap)
      .sort((a, b) => b.n - a.n)
      .slice(0, max);
  const phases = obj.phases || {};
  // scenes may arrive as an object map or as the batch-style array
  const rawScenes = obj.scenes || {};
  const sceneList = Array.isArray(rawScenes)
    ? rawScenes.map((s) => ({ key: sceneKey(s.key || s.label), label: s.label || s.key, items: s.items }))
    : Object.entries(rawScenes).map(([k, v]) => ({ key: sceneKey(k), label: (v && v.label) || k.replace(/_/g, " "), items: v && (v.items || v) }));
  const scenes = {};
  for (const s of sceneList) {
    if (!s.key || !Array.isArray(s.items)) continue;
    const its = arr(s.items, 5);
    if (its.length) scenes[s.key] = { label: String(s.label || s.key).trim().slice(0, 60), items: its };
    if (Object.keys(scenes).length >= 8) break;
  }
  return {
    label: label || obj.label || key,
    aliases: [...new Set([...(aliases || []), ...((Array.isArray(obj.aliases) && obj.aliases) || [])].map((a) => String(a).toLowerCase()))],
    reviews: Number(reviews || obj.reviews) || 0,
    reward: arr(obj.reward, 8),
    punish: arr(obj.punish, 8),
    expectations: arr(obj.expectations, 6),
    prose: arr(obj.prose, 6),
    phases: Object.fromEntries(PHASES.map((p) => [p, arr(phases[p] || obj[p], 6)])),
    scenes,
    voices: arr(obj.voices, 8, 90),
    notes: typeof obj.notes === "string" ? obj.notes.trim().slice(0, 600) : "",
  };
}

function parseLoose(raw) {
  const t = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const f = t.indexOf("{");
  const l = t.lastIndexOf("}");
  try {
    return JSON.parse(f !== -1 && l > f ? t.slice(f, l + 1) : t);
  } catch {
    return null;
  }
}

// Full pipeline for one genre: reviews [{rating, votes, text}] → lens.
export async function distillGenre({ key, label, aliases, reviews, complete, batchSize = 40, onProgress }) {
  const batches = [];
  for (let i = 0; i < reviews.length; i += batchSize) batches.push(reviews.slice(i, i + batchSize));
  const observations = [];
  for (let i = 0; i < batches.length; i++) {
    const raw = await complete(batchPrompt({ genre: key, label, reviews: batches[i] }));
    const obs = parseObservations(raw);
    if (obs) observations.push(obs);
    if (onProgress) onProgress({ batch: i + 1, of: batches.length });
  }
  const merged = mergeObservations(observations);
  const composed = await complete(composePrompt({ genre: key, label, merged, reviews: reviews.length }));
  return normalizeLens(composed, { key, label, aliases, reviews: reviews.length });
}
