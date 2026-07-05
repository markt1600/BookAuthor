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

  return findings.slice(0, 7);
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
  "Spend real time inside the viewpoint character's head; let outward action stay sparse.",
  "Include a stretch of plain summary — narrate across time instead of dramatizing a scene.",
  "Let sentence fragments do some of the work this section.",
  "Begin mid-action or mid-conversation, with no scene-setting preamble.",
  "Let something ordinary happen that is NOT symbolic of anything — a meal, an errand, weather that means nothing.",
];

export function textureRoll(book) {
  const sections = (book.turns || []).filter((t) => t && t.author === "claude").length;
  if (sections === 0) return ""; // the opening section writes free
  const seed = String(book.id || "")
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  const pick = TEXTURES[(seed + sections) % TEXTURES.length];
  return `A texture note for THIS section only (a deliberate variety device — follow it unless it would genuinely break the story): ${pick}`;
}

// Everything variety-related for the next generation, in one block.
export function varietyBlock(book) {
  const parts = [shapeNote(book)];
  if (book.mode === "guide") parts.push(textureRoll(book));
  return parts.filter(Boolean).join("\n");
}

// ---- Built-in style exemplars ------------------------------------------------
// Original passages written for Loom (not excerpts of any published work) that
// demonstrate each guide-mode style's voice. Used as the voice-anchoring sample
// whenever the author hasn't supplied their own.

export const STYLE_EXEMPLAR = {
  literary:
    "The orchard had gone to seed years before she came back, and yet she walked it as if the rows still held. Light moved in the long grass. Her father used to stand here with his hat off, listening to something she had been too young to hear, and she wondered now whether it had been the bees or only his own blood. A plane crossed high up, soundless. She put her hand on the gray bark of a tree that no longer bore and felt the old argument start up in her quietly, the one between staying and being gone.",
  cinematic:
    "The truck hit the guardrail doing eighty and kept going, sparks fanning off the steel. Reyes was already out of the cruiser. He took the embankment in four strides, slid the last of it on loose gravel, and got a hand on the door as the cab tipped. Inside, the driver hung against the belt, blood in his eyebrows, the radio still playing something with horns in it. “Hey. Hey. Look at me.” The engine ticked. Below them the river ran black under the bridge lights, patient as anything.",
  hemingway:
    "They came down to the river before it was light. The water was fast there and cold from the mountains and they heard it before they saw it. Tom carried the rods and the boy carried the basket with the bread and the wine in it. They did not talk. When it was light enough Tom tied on a small fly and worked out line and laid it across the current. The fly came around in the slick water below the stones. Nothing took it. He cast again and watched the line swing. The boy sat on the bank and said nothing, which was right.",
  murakami:
    "The phone rang at two in the morning, and I knew before I answered that it would be her. It had been four years. I was boiling water for spaghetti — don't ask why, at that hour — and the kitchen smelled faintly of the cigarettes of whoever had lived there before me. “Do you still have the record?” she asked. No hello. Somewhere behind her voice I could hear wind, or a highway, or the sea. I said I did, though I hadn't thought of it in years. “Good,” she said. “Don't play it tonight.” Then she hung up, and the water went on boiling.",
  burdett:
    "The farang dies badly and everyone on the soi knows it before the police do; news here travels by noodle cart. I stand over what is left of him while the rain holds off out of respect, and I think: last life, this man was a jealous husband — you can read it in the way karma has arranged the wound. My partner wants his wallet. I want his story. Out on the klong a boat goes by loaded with marigolds for the temple, and the boatman looks at the body, then at me, and grins, because in this city even death is a form of commerce.",
  adventure:
    "The rope bridge was gone — cut, not fallen, the ends still bleeding fresh fiber — which meant Delgado's men were ahead of them after all. Kate measured the gorge with her eye: forty feet, less at the narrow point by the dead cedar. “We climb down,” Marsh said. “No time.” She was already backing up for the run. Below, the river showed its teeth. Behind them, faint but closing, came the dogs. She hit the edge at a dead sprint, and for one long second the canyon owned her — then her boots found rock and she was rolling, alive, reaching back for the pack Marsh threw.",
  minimalist:
    "He set two cups on the table. She kept her coat on. Outside, someone was scraping ice off a windshield, on and on. “You look well,” she said. “I'm fine.” The coffee was too hot to drink and they sat with their hands around the cups, not drinking. He thought about the last time she had been in this kitchen. The scraping stopped. A car door. An engine. She turned her cup a quarter turn and looked at him. “So,” she said. “Tell me.”",
};

// The nudge appended to the second draft when "two takes" is on, so the retry
// explores a different region of the space instead of paraphrasing take one.
export const SECOND_TAKE_NOTE =
  "This is an alternative SECOND take of the same section. Approach it from a genuinely different angle than an obvious first attempt — a different entry point, different beats or emphasis, a different texture. Do not simply reword; make different choices.";
