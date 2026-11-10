// Prose-craft utilities: a deterministic AI-tell linter, section shape memory,
// rotating texture constraints, and built-in style exemplars. Pure JS with no
// dependencies — shared by the server (prompt building, polish pass) and the
// client (the "Prose tells" readout in the reader's notes).

const words = (t) => (String(t || "").match(/\S+/g) || []).length;

// ---- The tell-linter --------------------------------------------------------
// Mechanical, deterministic scan for the constructions and stock phrases that
// mark prose as machine-written. Returns human-readable findings, phrased as
// repair instructions so they can be dropped straight into the polish prompt.

const STOCK_PHRASES = [
  [/breath (?:he|she|they|I) (?:didn['’]t|hadn['’]t) (?:know|known|realized?)/i, "a breath they didn't know they were holding"],
  [/didn['’]t (?:quite )?reach (?:his|her|their|my) eyes/i, "a smile that didn't reach the eyes"],
  [/knuckles (?:whiten|going white|went white|white against)/i, "whitening knuckles"],
  [/something (?:in (?:him|her|them|me) )?shifted/i, "“something shifted”"],
  [/let out a (?:breath|long breath|slow breath|sigh) (?:he|she|they|I)/i, "“let out a breath”"],
  [/\ba beat(?: passed| of silence)\b/i, "“a beat passed”"],
  [/the silence (?:stretched|hung|settled)/i, "the stretching/hanging silence"],
  [/(?:barely|just) above a whisper/i, "“barely above a whisper”"],
  [/\bunreadable (?:expression|look|face)\b/i, "an “unreadable expression”"],
  [/\b(?:he|she|they|I) exhaled slowly\b/i, "“exhaled slowly”"],
  [/testament to/i, "“testament to”"],
  [/\btapestry of\b/i, "“tapestry of”"],
];

const splitSentences = (t) =>
  String(t)
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

// Scan a passage; returns an array of finding strings (capped), empty = clean.
export function lintProse(text) {
  const t = String(text || "");
  const n = words(t);
  const findings = [];
  if (n < 40) return findings;

  // Sentence-length burstiness: human prose mixes 4-word and 40-word sentences;
  // uniform lengths are a machine tell. Coefficient of variation below ~0.45
  // over a decent sample reads flat.
  const lens = splitSentences(t)
    .map((s) => words(s))
    .filter((l) => l > 0);
  if (lens.length >= 8) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lens.length);
    if (mean > 6 && sd / mean < 0.45) {
      findings.push(
        `Sentence lengths are unusually uniform (average ~${Math.round(mean)} words with little variation) — mix short sentences in with long ones.`
      );
    }
  }

  // The "not X, but Y" contrast construction.
  const notBut =
    (t.match(/\bnot\s+(?:a\s+|an\s+|the\s+)?\w+(?:\s+\w+)?\s*[,;—-]\s*but\b/gi) || []).length +
    (t.match(/\b(?:wasn|isn|weren)['’]t\s+[^.!?\n]{1,40}[.;]\s*It\s+was\b/gi) || []).length;
  if (notBut >= 2) {
    findings.push(`${notBut}× "not X, but Y" contrast constructions — keep at most one; rephrase the rest.`);
  }

  // Rule-of-three lists.
  const triads = (t.match(/\b\w+(?:\s\w+)?,\s+\w+(?:\s\w+)?,\s+and\s+\w+/g) || []).length;
  if (triads >= 3) {
    findings.push(`${triads} rule-of-three lists ("X, Y, and Z") — break the rhythm; name one thing, or two.`);
  }

  // Em-dash density.
  const dashes = (t.match(/—|--/g) || []).length;
  if ((dashes * 1000) / n > 12) {
    findings.push(`Heavy em-dash use (${dashes} in ~${n} words) — swap several for commas or full stops.`);
  }

  // The dramatic one-line paragraph as a scene button (non-dialogue).
  const paras = t
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length >= 4) {
    const buttons = paras.filter((p) => {
      const w = words(p);
      return w > 0 && w <= 10 && !/^["“‘']/.test(p);
    }).length;
    if (buttons >= 2) {
      findings.push(
        `${buttons} one-line dramatic paragraphs — keep at most one; fold the others into neighboring paragraphs.`
      );
    }
  }

  // Anaphora runs: 3+ consecutive sentences opening on the same word.
  const sentences = splitSentences(t);
  const firsts = sentences.map((s) => (s.match(/^[^\w]*(\w+)/) || [])[1] || "");
  let run = 1;
  for (let i = 1; i < firsts.length; i++) {
    if (firsts[i] && firsts[i].toLowerCase() === firsts[i - 1].toLowerCase() && firsts[i].toLowerCase() !== "the") {
      run += 1;
      if (run === 3) {
        findings.push(
          `An anaphora run — 3+ consecutive sentences opening with "${firsts[i]}" — vary the sentence openings.`
        );
        break;
      }
    } else run = 1;
  }

  // Stock body-language / narrator kit.
  for (const [re, label] of STOCK_PHRASES) {
    if (re.test(t)) findings.push(`Stock phrase: ${label} — replace it with something particular to this character.`);
  }

  findings.push(...lintOverwriting(t));
  findings.push(...lintDialogue(t));

  return findings.slice(0, 10);
}

// ---- Overwriting tells -------------------------------------------------------
// Verbosity that can be counted: similes stacked on similes, perception routed
// through "she saw / he felt / seemed to" instead of stated, and a section that
// opens on scenery before anyone does anything. Thresholds are per-1000-words
// so a long section isn't punished for its length.

const FILTERS =
  /\b(?:(?:he|she|they|I|we)\s+(?:could\s+)?(?:saw|see|felt|feel|heard|hear|noticed|notice|watched|realized|realised|wondered|knew)\s+(?:that\s+|how\s+|the\s+|a\s+|an\s+|his\s+|her\s+|their\s+|its\s+|it\s+)|(?:seemed|appeared|began|started)\s+to\s+\w+)/gi;
const SCENERY =
  /\b(?:sky|sun|sunlight|light|dawn|dusk|morning|evening|night|rain|wind|fog|mist|clouds?|air|snow|heat|cold|shadows?|moon|stars?|horizon|room|street|city|town|village|house|building|window|walls?|hills?|fields?|trees?|sea|river)\b/gi;

export function lintOverwriting(text) {
  const t = String(text || "");
  const n = words(t);
  const out = [];
  if (n < 120) return out;
  const per1k = (c) => (c * 1000) / n;

  const similes = (t.match(/\b(?:like an?|like the|as if|as though|as \w+ as)\b/gi) || []).length;
  if (similes >= 4 && per1k(similes) > 9) {
    out.push(
      `${similes} similes in ~${n} words ("like a…", "as if…") — keep the one that does real work and state the rest plainly.`
    );
  }

  const filters = (t.match(FILTERS) || []).length;
  if (filters >= 4 && per1k(filters) > 10) {
    out.push(
      `${filters} filtered or hedged constructions ("she saw the…", "he felt…", "seemed to", "began to") — state the thing directly instead of routing it through the character's noticing.`
    );
  }

  // A scenic opening: the first paragraph is long, has no dialogue, and leans
  // on weather / light / setting nouns before anything happens.
  const first = (t.trim().split(/\n{2,}/)[0] || "").trim();
  const fw = words(first);
  if (fw >= 35 && !/["“]/.test(first)) {
    const scenery = (first.match(SCENERY) || []).length;
    if (scenery >= 4 && scenery / fw > 0.05) {
      out.push(
        "The section opens on a paragraph of scene-setting (weather, light, the look of the place) — start where something happens and fold in one detail of the setting as it goes."
      );
    }
  }
  return out;
}

// ---- Dialogue tells ----------------------------------------------------------
// Models default to dialogue that is too tidy: adverb-propped tags, fancy
// speech verbs, characters forever addressing each other by name, and every
// line a complete, well-formed sentence. Deterministic, like the rest.

const SPEECH_VERBS = "said|asked|replied|answered|whispered|muttered|murmured|shouted|called|added|told";
const BOOKISMS =
  "exclaimed|interjected|opined|chuckled|hissed|growled|breathed|intoned|remarked|quipped|retorted|snapped|purred|grumbled|chortled|ejaculated|sneered|smirked|laughed|sighed";

export function lintDialogue(text) {
  const t = String(text || "");
  const out = [];
  const quoted = t.match(/["“][^"”\n]{2,}["”]/g) || [];
  if (quoted.length < 4) return out;

  // Adverb-propped tags: "she said softly", "softly, he asked".
  const advTags =
    (t.match(new RegExp(`\\b(?:${SPEECH_VERBS})\\s+\\w+ly\\b`, "gi")) || []).length +
    (t.match(new RegExp(`\\b\\w+ly,?\\s+(?:he|she|they|I|[A-Z]\\w+)\\s+(?:${SPEECH_VERBS})\\b`, "g")) || []).length;
  if (advTags >= 2) {
    out.push(
      `${advTags} adverb-propped dialogue tags ("said softly", "asked quietly") — cut the adverbs and let the line itself carry the tone.`
    );
  }

  // Said-bookisms used as tags, right after a closing quote or right before an opening one.
  const bookisms =
    (t.match(new RegExp(`["”],?\\s+(?:he|she|they|I|[A-Z]\\w+)\\s+(?:${BOOKISMS})\\b`, "g")) || []).length +
    (t.match(new RegExp(`\\b(?:${BOOKISMS})\\b[^.!?\\n]{0,24}["“]`, "gi")) || []).length;
  if (bookisms >= 2) {
    out.push(
      `${bookisms} fancy speech tags ("exclaimed", "hissed", "chuckled") — "said" or an action beat almost always reads better.`
    );
  }

  // Characters calling each other by name: "Yes, Mara." / "Mara, listen—" /
  // "Very well, Tomas, we stay." (a trailing comma means a tag follows).
  const nameAddress =
    (t.match(/["“][^"”\n]*?,\s+[A-Z][a-z]{2,}[.!?…,]["”]/g) || []).length +
    (t.match(/["“][^"”\n]*?,\s+[A-Z][a-z]{2,},\s/g) || []).length +
    (t.match(/["“][A-Z][a-z]{2,},\s+[a-z]/g) || []).length;
  if (nameAddress >= 3) {
    out.push(
      `${nameAddress} lines where a speaker addresses someone by name — people rarely do this in real conversation; keep at most one.`
    );
  }

  // Every line a polished, complete sentence: no fragments, no interruptions,
  // no trailing off — the too-articulate tell.
  const lines = quoted.map((q) => q.slice(1, -1).trim()).filter(Boolean);
  if (lines.length >= 6) {
    const rough = lines.filter(
      (l) =>
        words(l) <= 3 || // a fragment or a one-word answer
        /[—–…-]\s*$/.test(l) || // trails off or is cut off
        /\s[—–]\s|—/.test(l) || // an interruption or a break inside the line
        !/[.!?…,]$/.test(l) || // no terminal punctuation (a trailing comma = a tag follows)
        /\b(?:um|uh|hm+)\b|(?:^|,\s*)(?:you know|I mean)(?=,|\s*$)/i.test(l) // a filler/hesitation (not the literal "you know it")
    ).length;
    const avg = lines.reduce((a, l) => a + words(l), 0) / lines.length;
    if (rough === 0 && avg >= 9) {
      out.push(
        `All ${lines.length} lines of dialogue are complete, polished sentences (average ~${Math.round(
          avg
        )} words) — let someone interrupt, trail off, deflect, or answer in a fragment.`
      );
    }
  }

  return out;
}

// ---- Section shape memory ---------------------------------------------------
// Every generated section tends toward the same shape (enter on scene-setting,
// land on a quiet button). These heuristics look at how recent AI sections
// opened and closed, and produce a steering note when a pattern repeats.

function endingClass(text) {
  const paras = String(text)
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) return "";
  const last = paras[paras.length - 1];
  if (/^["“‘']/.test(last) || /["”’']\s*$/.test(last)) return "dialogue";
  if (words(last) <= 16 && paras.length > 1) return "short-button";
  return "prose";
}

function openingClass(text) {
  const first = String(text).trim().split(/\n{2,}/)[0] || "";
  return /^["“‘']/.test(first.trim()) ? "dialogue" : "prose";
}

export function shapeNote(book) {
  const ai = (book.turns || []).filter((t) => t && t.author === "claude" && t.text);
  if (ai.length < 2) return "";
  const [a, b] = ai.slice(-2);
  const notes = [];
  const endA = endingClass(a.text);
  const endB = endingClass(b.text);
  if (endA === endB && endA === "short-button") {
    notes.push(
      "The last two sections each ended on a short, dramatic closing line — do NOT end this one that way. End mid-motion, on dialogue, or on a plain, unremarkable sentence."
    );
  } else if (endA === endB && endA === "dialogue") {
    notes.push("The last two sections both ended on a line of dialogue — end this one in narration instead.");
  }
  if (openingClass(a.text) === "dialogue" && openingClass(b.text) === "dialogue") {
    notes.push("The last two sections both opened on dialogue — open this one differently.");
  }
  return notes.join("\n");
}

// ---- Texture rolls ----------------------------------------------------------
// One rotating craft constraint per section, seeded deterministically from the
// book id + section count, to forcibly break the model's house style. Guide
// mode only (in participate mode the user's own prose sets the texture).

const TEXTURES = [
  "Let dialogue carry most of this section — minimal narration between the lines.",
  "No similes or metaphors this section; carry it on concrete action and speech.",
  "Let one paragraph run long and unbroken — a full page of momentum in a single breath.",
  "Favor short paragraphs and quick cuts this section.",
  "Stay close to physical action; keep interiority to a minimum.",
  "Let the viewpoint character's thinking drive this section — thinking as weighing, deciding, and misjudging under pressure, not as reflection on what already happened.",
  "Cover the unimportant ground in a few lines of plain summary — narrate across time — so the scene that matters gets the room.",
  "Let sentence fragments do some of the work this section.",
  "Begin mid-action or mid-conversation, with no scene-setting preamble.",
  "Describe nothing twice and nothing at length this section: one exact detail per person or place, then move on.",
];

export function textureRoll(book, note = "") {
  const sections = (book.turns || []).filter((t) => t && t.author === "claude").length;
  if (sections === 0) return ""; // the opening section writes free
  const seed = String(book.id || "")
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  const pick = TEXTURES[(seed + sections) % TEXTURES.length];
  return `A texture note for THIS section only (a deliberate variety device — follow it unless it would genuinely break the story or shortchange a pivotal moment): ${pick}${note || ""}`;
}

// Everything variety-related for the next generation, in one block.
// `textureNote` is an optional rider on the texture roll (a content pack may
// supply one; see maturity.js).
export function varietyBlock(book, textureNote = "") {
  const parts = [shapeNote(book)];
  if (book.mode === "guide") parts.push(textureRoll(book, textureNote));
  return parts.filter(Boolean).join("\n");
}

// ---- Built-in style exemplars ------------------------------------------------
// Original passages written for Loom (not excerpts of any published work) that
// demonstrate each guide-mode style's voice. Used as the voice-anchoring sample
// whenever the author hasn't supplied their own.

export const STYLE_EXEMPLAR = {
  literary:
    "The orchard had gone to seed years before she came back, and yet she walked it as if the rows still held. Light moved in the long grass. Her father used to stand here with his hat off, listening to something she had been too young to hear, and she wondered now whether it had been the bees or only his own blood. A plane crossed high up, soundless. She put her hand on the gray bark of a tree that no longer bore and felt the old argument start up in her quietly, the one between staying and being gone.",
  hemingway:
    "They came down to the river before it was light. The water was fast there and cold from the mountains and they heard it before they saw it. Tom carried the rods and the boy carried the basket with the bread and the wine in it. They did not talk. When it was light enough Tom tied on a small fly and worked out line and laid it across the current. The fly came around in the slick water below the stones. Nothing took it. He cast again and watched the line swing. The boy sat on the bank and said nothing, which was right.",
  murakami:
    "The phone rang at two in the morning, and I knew before I answered that it would be her. It had been four years. I was boiling water for spaghetti — don't ask why, at that hour — and the kitchen smelled faintly of the cigarettes of whoever had lived there before me. “Do you still have the record?” she asked. No hello. Somewhere behind her voice I could hear wind, or a highway, or the sea. I said I did, though I hadn't thought of it in years. “Good,” she said. “Don't play it tonight.” Then she hung up, and the water went on boiling.",
  burdett:
    "The farang dies badly and everyone on the soi knows it before the police do; news here travels by noodle cart. I stand over what is left of him while the rain holds off out of respect, and I think: last life, this man was a jealous husband — you can read it in the way karma has arranged the wound. My partner wants his wallet. I want his story. Out on the klong a boat goes by loaded with marigolds for the temple, and the boatman looks at the body, then at me, and grins, because in this city even death is a form of commerce.",
  minimalist:
    "He set two cups on the table. She kept her coat on. Outside, someone was scraping ice off a windshield, on and on. “You look well,” she said. “I'm fine.” The coffee was too hot to drink and they sat with their hands around the cups, not drinking. He thought about the last time she had been in this kitchen. The scraping stopped. A car door. An engine. She turned her cup a quarter turn and looked at him. “So,” she said. “Tell me.”",
};

// The nudge appended to the second draft when "two takes" is on, so the retry
// explores a different region of the space instead of paraphrasing take one.
export const SECOND_TAKE_NOTE =
  "This is an alternative SECOND take of the same section. Approach it from a genuinely different angle than an obvious first attempt — a different entry point, different beats or emphasis, a different texture. Do not simply reword; make different choices.";

// The review model sometimes returns the "suggestions" note as one long
// paragraph instead of newline-separated lines, so the UI shows a single card.
// Split a single blob of 3+ sentences into up to three balanced chunks at
// sentence boundaries so each idea gets its own line (one card). Returns the
// input unchanged when it already has line breaks or is too short to be a
// multi-idea blob.
export function splitSuggestionBlob(text) {
  const t = String(text || "").trim();
  if (!t || /\n/.test(t) || t.length < 200) return t;
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length < 3) return t;
  const size = Math.ceil(parts.length / 3);
  const chunks = [];
  for (let i = 0; i < parts.length; i += size) chunks.push(parts.slice(i, i + size).join(" "));
  return chunks.join("\n");
}

// The live PACING steer, closed back into the next generation. The analyzer
// judges each refresh whether the story's plot momentum is running hot or cold
// (it writes a one-line "pacing" note: TOO FAST / TOO SLOW / STEADY + a short
// reason); the next section compensates — slow the plot down when it's racing,
// push it forward when it's stalling. Framed as a lean, not a rule, so a scene
// that genuinely needs its own pace can deviate on purpose. Returns "" when the
// analyzer hasn't flagged a problem (STEADY) or there's no analysis yet, so a
// book with no pacing read generates exactly as before.
export function pacingSteer(m) {
  const raw = String((m && m.pacing) || "").trim();
  if (!raw) return "";
  const low = raw.toLowerCase();
  // Strip the leading label + separator so the editor's reason is preserved.
  const reason = raw.replace(/^(too fast|too slow|steady)\b[\s:;,—–-]*/i, "").trim();
  const why = reason ? ` (${reason})` : "";
  if (low.startsWith("too fast")) {
    return `PACING STEER — the editor reads the current plot pacing as TOO FAST${why}. In this section, slow the plot DOWN: stay inside the one scene that matters and play it out beat by beat — the exchange line by line, the hesitation, the choice, what it immediately costs — and hold back new major events. Do NOT slow it with scenery, weather, backstory, or reflection: depth comes from what the characters do and say under pressure, not from more description. This is a lean, not a rule: if the scene itself needs a faster pace, deviate on purpose.`;
  }
  if (low.startsWith("too slow")) {
    return `PACING STEER — the editor reads the current plot pacing as TOO SLOW${why}. In this section, speed the plot UP: skip or compress to a line anything that only sets a mood or moves people into position, cut lingering description and repetition, and get to the next event that changes something — the section should end further along than it started. If that event is a turning point, it still gets its full scene; the time is saved on the way there. This is a lean, not a rule: if the scene itself needs to linger, deviate on purpose.`;
  }
  return ""; // STEADY (or unrecognized) — hold the current pace, no steer.
}

// ---- Scene weight -------------------------------------------------------------
// Length should follow importance. The beat planner labels each section with a
// "WEIGHT:" line — PIVOTAL (a turning point: decision, confrontation,
// revelation, reversal, loss, payoff), CONNECTIVE (it only moves people or
// information into position), or STANDARD — and the writer's word budget and
// length rule are derived from it, so a turning point gets room and a walk
// across town doesn't get the same 500 words. No plan (or no label) is
// STANDARD, which keeps the configured section length.

export function sectionWeight(plan) {
  const m = String(plan || "").match(/^[\s>*_-]*WEIGHT\s*[:—–-]\s*\**\s*(PIVOTAL|CONNECTIVE|STANDARD)\b/im);
  return m ? m[1].toUpperCase() : "STANDARD";
}

// The word budget for a section of the given weight. `base` is the configured
// section length. Bounded so a tiny or huge setting stays sane.
export function weightedTarget(base, weight) {
  const b = Math.max(20, Math.round(Number(base) || 0));
  if (weight === "PIVOTAL") return Math.round(b * 1.35);
  if (weight === "CONNECTIVE") return Math.max(Math.min(b, 100), Math.round(b * 0.6));
  return b;
}

// The length rule handed to the writer. A ceiling, never a quota: padding a
// section out to a word count is where most of the overwriting comes from.
export function lengthRule(base, weight) {
  const n = weightedTarget(base, weight);
  if (weight === "PIVOTAL") {
    return `Write about ${n} words. This section carries a turning point, so it gets extra room — and the turning point gets most of it: reach it within the first few sentences and spend at least two thirds of the words inside it, played out in scene, moment by moment. No warm-up, no wind-down.`;
  }
  if (weight === "CONNECTIVE") {
    return `Write no more than about ${n} words. This section is connective — it positions the story for what comes next — so cover the ground briskly, in summary or a single quick scene with one sharp detail, and stop as soon as the story is in position. Shorter is fine.`;
  }
  return `Write up to about ${n} words (it may run ~10% over if a scene needs it). That is a ceiling, not a quota: when the section's work is done, stop — coming in a quarter short is better than padding with description, recap, or reflection to reach the count.`;
}
