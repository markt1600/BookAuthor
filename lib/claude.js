// The prompts: everything the app asks a model to do, and nothing about which
// model does it. Model names, the online/offline toggle, and the transport all
// live in ./providers.js.
import { MODEL, ANALYSIS_MODEL, REVISE_MODEL, AUDIT_MODEL, CACHE_MIN_CHARS, tuned, withThinking, runText, complete } from "./providers.js";
import { ARC_HORIZON } from "@/lib/book";
import { splitPlan, prioritiesBlock, normalizeAudit, clampBrief, sanitizeOutline, cleanDirections, MAX_PRIORITIES, OUTLINE_MAX, ENDGAME_MAX, ENDGAME_MIN, criticismLines, cleanSectionReport } from "./storyplan.js";
import { maturityText, LATITUDE_TEXT, PACK_STYLE_PROMPTS, adultWriterRules, economyNote, polishException, judgeNote, adultReview } from "./maturity.js";
import { splitSuggestionBlob, pacingSteer, sectionWeight, weightedTarget, lengthRule } from "./craft.js";

// Steer every writing mode away from the tells of "AI prose." Injected into each
// system prompt that actually generates narrative (both write modes and the
// revision passes) so the guidance is consistent everywhere.
const NATURAL_PROSE =
  "Write like a human novelist, not an AI. Not every sentence wants to be profound, and not every observation needs an elegant metaphor — let plain, declarative sentences carry their share, and let some moments stay ordinary: some paragraphs should be purely functional, some things deserve one detail rather than three, and not everything a character notices has to mean something. Vary sentence rhythm for real — mix four-word sentences among forty-word ones; uniform sentence lengths are a machine tell. Avoid the trademark AI constructions: the \"not X, but Y\" contrast (\"It wasn't anger. It was something older.\"), rule-of-three lists (\"the salt, the smoke, the distant bells\"), the dramatic one-line paragraph as a scene button, anaphora runs (\"She remembered the boat. She remembered the rope.\"), and the \"the way a thing does X when Y\" simile. Avoid the stock body-language kit: breaths characters didn't know they were holding, smiles not reaching eyes, whitening knuckles, \"something shifted\", beats passing, silences stretching. Resist ending scenes or paragraphs on a tidy aphorism or reflexive thematic summing-up. Trust concrete detail, action, and dialogue over decoration — and make at least one choice a competent-but-safe writer wouldn't: a word, a beat, a place to cut.";

// The three faults this studio's prose drifts into when left alone, each with
// its own rule so they can be injected where they apply:
//   ECONOMY    — description and scenes that haven't earned their words;
//   PROPORTION — connective scenes at full length, turning points rushed;
//   LOGIC      — plot holes: uncaused events, impossible knowledge, coincidence.
const ECONOMY =
  "ECONOMY — say it once, and only if it matters. Describe a thing only when the viewpoint character would notice it right now AND it changes what the reader understands, expects, or feels. Give a person or place one or two exact details, then move on: never an inventory, never weather, light, or décor as throat-clearing, and never a second description of something the book has already established. Don't dramatize what nobody needs to watch — arrivals, departures, travel, greetings, waking up, getting from one room to another go in a clause or are skipped. Enter a scene as late as it still makes sense and leave once its turn has happened. Don't narrate a feeling the action or the dialogue has already shown, don't restate in reflection what was just dramatized, and don't have characters tell each other what both already know. One figure of speech per paragraph at most; most paragraphs need none.";

const PROPORTION =
  "PROPORTION — length follows importance. A decision, a confrontation, a revelation, a reversal, a loss, the payoff of something planted: these are played out in full, in scene, moment by moment — the exchange line by line, the hesitation, the choice, what it immediately costs — and are never summarized, skipped past, cut away from, or reported after the fact. Everything that merely gets the story there is compressed to a few lines. If this section holds such a moment, that moment IS the section: reach it within the first few sentences and give it most of the words.";

const LOGIC =
  "LOGIC — the story must hold up for a reader who is paying attention. Every event needs a cause that is already on the page. Characters act only on what they have had a way to learn, still want what they wanted a page ago unless something changed it, and cannot be in two places or cross a distance in no time. Keep track of who knows what, who is present, what is in whose hands, injuries, the time of day, and what has been locked, lost, promised, or broken. No problem is solved by coincidence, sudden unexplained competence, or a convenient arrival, and an action that should have consequences has them. If the direction asks for something the story so far does not yet allow, supply the missing link in a sentence — how they found out, why they came, where it came from — rather than writing past the gap. Never contradict the continuity notes, the chapter digest, the canon, or the cast sheet.";

// A content pack may exempt its own scenes from the economy rule (see maturity.js).
function economyRule(guide) {
  const note = economyNote(guide);
  return note ? `${ECONOMY} ${note}` : ECONOMY;
}

// Dialogue-specific guidance: models default to dialogue that is too articulate
// and too cooperative. Injected alongside NATURAL_PROSE wherever prose with
// dialogue is generated (not in the polish pass, which shouldn't invent lines).
const NATURAL_DIALOGUE =
  "Write dialogue the way people actually talk: let characters interrupt, deflect, trail off, answer the wrong question, or say something briefly banal. Not every line should be articulate or advance the plot, and people rarely say exactly what they mean. Keep each character's voice distinct — diction, rhythm, verbal habits, what they won't say — rather than giving everyone the same fluent register.";

// The five built-in styles; a content pack may add more (see maturity.js).
const STYLE_PROMPT = {
  ...PACK_STYLE_PROMPTS,
  literary:
    "Literary fiction — precise, psychologically interior prose; an image only where it does work a plain statement couldn't; let subtext and rhythm carry meaning.",
  hemingway:
    "Hemingway — terse and declarative; short, plain sentences and concrete nouns; minimal adjectives and adverbs; emotion conveyed through action and dialogue, not description (the iceberg theory).",
  murakami:
    "Murakami-esque contemporary magical realism — a calm, detached, understated voice in plain yet hypnotic prose, into which the uncanny quietly intrudes. Set ordinary modern life (solitary routines, cooking, jazz and classical records, bars, cats, late-night phone calls) beside dreamlike, unexplained phenomena: parallel worlds, prophetic dreams, doppelgängers, talking animals, wells and hidden doorways, the sense that reality has a hidden seam. Favor melancholic, alienated protagonists and enigmatic women who appear and vanish; leave symbols and questions deliberately unresolved. Include a frank, dreamlike sensuality and mature sexual undercurrent WHERE THE BOOK'S MATURITY SETTINGS ALLOW (defer to them). Keep the tone matter-of-fact even as events turn surreal.",
  burdett:
    "Burdett / 'Bangkok 8' crime noir — gritty, atmospheric contemporary realism in a wry, philosophical first-person voice: a devout-Buddhist's-eye view of a corrupt modern world. Ground the reader in the place with quick, exact strokes — heat, traffic, street food, markets, temples, neon, the river — a detail or two as the action passes through, never a tour. Let Buddhist ideas of karma, fate, and reincarnation sit as the narrator's sincere worldview (a philosophical lens, not literal magic) beside police corruption, organized crime, the drug and sex trades, and the collision of Eastern spirituality with Western appetite. Dark humor, sharp cross-cultural social observation, morally grey characters, and an unflinching, matter-of-fact treatment of vice and violence WHERE THE BOOK'S MATURITY SETTINGS ALLOW (defer to them). Keep it grounded and realistic — no supernatural events.",
  minimalist: "Minimalist — spare, restrained, concrete; short sentences, white space, understatement.",
};
const POV_TEXT = {
  first: "first person",
  third_limited: "third person limited",
  third_omniscient: "third person omniscient",
};
const TENSE_TEXT = { past: "past tense", present: "present tense" };
/**
 * Guide mode: the user is the director and supplies an instruction; the AI
 * writes the next ~500-word section of prose. Returns plain prose only.
 */
export async function guideStory({ title, author, guide, prompt, opening, recent, memory, whole, arc, sections, targetWords, bible, cast, voiceSample, position, variety, variant, digest, plan, lens, onDelta }) {
  const g = guide || {};
  const base = Math.max(150, Math.min(800, targetWords || 500));
  // Length follows importance: the beat plan's WEIGHT label sets the budget.
  const weight = sectionWeight(plan);
  const target = weightedTarget(base, weight);
  const maxTokens = Math.min(8192, Math.round(target * 2.2) + 256);
  const first = !recent && !whole;
  const adultRules = adultWriterRules(guide);

  const system = [
    "You are the sole author of a novel. The user is the director: they tell you what should happen next, and you write the prose.",
    "",
    "Hard rules:",
    `- ${lengthRule(base, weight)}`,
    `- Prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
    `- Narrate in ${POV_TEXT[g.pov] || POV_TEXT.third_limited}, ${TENSE_TEXT[g.tense] || TENSE_TEXT.past}.`,
    `- ${LATITUDE_TEXT}`,
    `- ${maturityText(g)}`,
    adultRules ? `- ${adultRules}` : "",
    first
      ? "- This is the opening section of the book. Establish voice, character, and place with confidence — through a situation already in motion and a person who wants something, not through a descriptive preamble."
      : "- Continue seamlessly from where the story left off; honor every established name, place, and fact. Do not recap or summarize.",
    `- ${NATURAL_PROSE}`,
    `- ${economyRule(g)}`,
    `- ${PROPORTION}`,
    `- ${LOGIC}`,
    `- ${NATURAL_DIALOGUE}`,
    "- Output prose ONLY — no headings, no titles, no author's notes, no commentary, no markdown, no restating the instruction.",
  ].join("\n");

  const mem = memoryBlock(memory);
  // The editor's desk: when the beat plan carries a ranked ruling, the writer
  // gets that ruling INSTEAD of the raw advisory notes it was distilled from.
  const desk = splitPlan(plan);
  const ruled = desk.priorities.length > 0;
  const craft = ruled ? referenceNotes(memory) : craftNotes(memory);
  const pacing = ruled ? "" : pacingSteer(memory);
  const titleLine = `Working title: "${title}"  ·  Credited author / director: ${author}`;
  const voice = voiceBlock(voiceSample);
  // Append-only cached prefix: the whole-manuscript block must END with the
  // manuscript text (its closing delimiter opens the tail) so the prefix from
  // the previous turn stays byte-identical and the cache read hits.
  const body = whole
    ? `The complete story so far (continue from the very end):\n----------\n${whole}`
    : opening
    ? `How the book opens (for voice & characters):\n----------\n${opening}\n----------`
    : "";
  // The voice sample is stable per book, so it lives with the cacheable prefix.
  const manuscript = [voice, body].filter(Boolean).join("\n");
  const tail = [
    whole ? "----------" : "",
    mem ? `Continuity notes (for consistency — do NOT copy verbatim):\n${mem}` : "",
    !whole ? digestBlock(digest) : "",
    bibleBlock(bible),
    castSheetBlock(cast),
    craft,
    pacing,
    recent && !whole
      ? `Most recent prose (continue directly from the end of this):\n----------\n${recent}\n----------`
      : "",
    position || "",
    ruled ? "" : variety || "",
    ruled ? "" : lens || "",
    `The director's instruction for this next section:\n"""${prompt}"""`,
    planBlock(ruled ? desk.beats : plan),
    ruled ? prioritiesBlock(desk.priorities) : arcBlock(arc, sections),
    variant || "",
    `\nWrite the next section now (${weight === "CONNECTIVE" ? `brief — at most ~${target} words` : `up to ~${target} words`}).`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = await runText(
    tuned(
      {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: cachedUserContent(titleLine, manuscript, tail) }],
      },
      0.92
    ),
    onDelta
  );
  if (!text) throw new Error("The AI author returned an empty section.");
  return text;
}

// Build the user message as content blocks, caching the large, stable manuscript
// prefix so back-to-back sections on a long book reuse it instead of re-reading
// the whole document each turn.
//
// Two invariants make the cache actually hit across turns:
// 1. The cached block must be APPEND-ONLY — the manuscript grows at its end, so
//    callers must NOT put a closing delimiter (or anything else) after the
//    manuscript text inside this block. The closing "----------" belongs at the
//    start of the tail. Otherwise every turn's bytes diverge right where the
//    previous breakpoint sat and nothing ever matches.
// 2. The threshold (CACHE_MIN_CHARS, from providers) must clear the model's
//    minimum cacheable prefix; below that the marker is silently ignored, so we
//    only split blocks when caching can actually engage.
function cachedUserContent(titleLine, manuscript, tail) {
  if (manuscript && manuscript.length > CACHE_MIN_CHARS) {
    return [
      { type: "text", text: `${titleLine}\n${manuscript}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: tail },
    ];
  }
  return [{ type: "text", text: [titleLine, manuscript, tail].filter(Boolean).join("\n") }];
}

// Format the long-horizon heading goals as soft, pace-aware steering. `sections`
// is the current AI-section count, used with each heading's bornTurns to judge
// how far along its runway it is (so the AI advances it the right amount).
function arcBlock(arc, sections = 0) {
  const items = (Array.isArray(arc) ? arc : []).filter((h) => h && h.text);
  if (!items.length) return "";
  const lines = items
    .map((h) => {
      const hz = ARC_HORIZON[h.pace] || ARC_HORIZON.gradually;
      const elapsed = Number.isFinite(h.bornTurns) ? Math.max(0, sections - h.bornTurns) : 0;
      let status;
      if (elapsed >= hz.turns) status = "it is now DUE — bring it to a head within the next section or two";
      else if (elapsed >= Math.ceil(hz.turns * 0.6))
        status = "well into its runway — let it visibly advance this section";
      else status = "early on its runway — advance it only subtly, do not rush it";
      return `- ${h.text}  [land this over ${hz.label}; set ~${elapsed} section(s) ago, so ${status}]`;
    })
    .join("\n");
  return (
    "Long-range destinations — these are NOT instructions for this one section, unlike the direction above. " +
    "Move each forward only as much as its runway calls for; pace it to arrive around the noted horizon, and never " +
    "resolve one early or dump it all into a single section:\n" +
    lines
  );
}

function memoryBlock(m) {
  if (!m) return "";
  const lines = [];
  if (m.genre) lines.push(`Genre: ${m.genre}`);
  if (m.synopsis) lines.push(`Story so far: ${m.synopsis}`);
  if (m.continuity) lines.push(`Established characters, places, facts & open threads:\n${m.continuity}`);
  if (m.style) lines.push(`Established voice & style: ${m.style}`);
  return lines.join("\n");
}

// The live editorial signals from the last analysis, closed back into the next
// generation: the top critique point (so the writing actively works on its
// current weakness) and the recently-used-imagery list (so the book doesn't
// keep reaching for the same pet images and phrases).
function craftNotes(m, { story = true } = {}) {
  if (!m) return "";
  const lines = [];
  const concerns = concernLines(m);
  if (concerns.length) {
    lines.push(
      "What the editor says is holding the story back, most serious first. Work against these through what happens in this section — pick whichever its events can honestly answer and answer it with action, choice or consequence; never name, explain or apologise for any of it in the prose:\n" +
        concerns.map((c, i) => `${i + 1}. ${c}`).join("\n")
    );
  }
  if (m.motifs) {
    lines.push(
      `Distinctive imagery, constructions & phrasing already used in recent sections — do NOT reuse or echo any of these:\n${m.motifs}`
    );
  }
  if (m.voices) {
    lines.push(`How each character talks — keep these voices distinct from one another:\n${m.voices}`);
  }
  const open = openLedgerLines(m.ledger);
  if (open.length) {
    lines.push(
      "Planted setups and promises to the reader still awaiting payoff (the setups-and-payoffs ledger). Pay one off only when the story is genuinely ready for it — never several in one section, and never by convenient coincidence — and don't re-plant what is already planted. Items marked stale have waited a long time; give them weight or a nudge:\n" +
        open.join("\n")
    );
  }
  // Story-level signals: only for passes allowed to change what happens (the
  // line-edit polish is not, so it never sees them).
  if (story) {
    const holes = noteLines(m.holes, 6);
    if (holes.length) {
      lines.push(
        "Open logic gaps in the story so far, flagged by the editor. Do not widen any of them or build further on the broken link. Where this section touches one, repair it in passing — a line that supplies the missing cause, knowledge, or consequence — without stopping the story to explain:\n" +
          holes.join("\n")
      );
    }
    const balance = noteLines(m.balance, 3);
    if (balance.length) {
      lines.push(
        "How recent sections spent their words (SLACK = ran long without changing anything; RUSHED = a turning point given too little room). Correct the pattern in this section — do not repeat it:\n" +
          balance.join("\n")
      );
    }
  }
  return lines.join("\n\n");
}

// What the writer still needs verbatim once the editor's desk has ruled: the
// two reference lists no ruling can stand in for — phrasing already used (so it
// isn't used again) and how each character talks. Everything advisory (the
// editor's concern, open gaps, setups, proportion) has been weighed by the desk.
function referenceNotes(m) {
  if (!m) return "";
  const lines = [];
  if (m.motifs) {
    lines.push(
      `Distinctive imagery, constructions & phrasing already used in recent sections — do NOT reuse or echo any of these:\n${m.motifs}`
    );
  }
  if (m.voices) {
    lines.push(`How each character talks — keep these voices distinct from one another:\n${m.voices}`);
  }
  return lines.join("\n\n");
}

// The editor's criticism from the last analysis ("What's holding it back"), a
// line per point, most serious first.
function concernLines(m, max = 4) {
  return criticismLines(m && m.critique, max);
}

// The editor's criticism as a block for the planning prompts.
function criticismBlock(critique) {
  const points = criticismLines(critique);
  return points.length
    ? `The editor's criticism — what is holding the book back, most serious first:\n${points.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
    : "";
}

// Split a newline-separated note into its lines, dropping an explicit "none".
function noteLines(text, max) {
  return String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(none|balanced|n\/a)\.?$/i.test(l))
    .slice(0, max);
}

// The ledger lines that are still open (not yet paid off), for the writer.
function openLedgerLines(ledger) {
  return String(ledger || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/\bpaid\b|\bresolved\b|\bpaid off\b|✓/i.test(l))
    .slice(0, 8);
}

// The chapter-by-chapter digest of the closed chapters — the memory of the
// book's middle, which the opening + recent window can't reach on a long book.
function digestBlock(digest) {
  const d = String(digest || "").trim();
  if (!d) return "";
  return `The book so far, chapter by chapter (the closed chapters; the current chapter's latest prose is shown below in full). Authoritative for everything outside the excerpts — keep every event, fact, and thread consistent with it:\n${d}`;
}

// The private beat plan for this section, from the planner.
function planBlock(plan) {
  const p = String(plan || "").trim();
  if (!p) return "";
  return `A private beat plan for THIS section (follow its shape and land its change; it is scaffolding — never print, quote, summarize, or refer to it in the prose):\n${p}`;
}

// The author-confirmed cast sheet (names, roles, voices) — hand-maintained.
function castSheetBlock(cast) {
  const c = String(cast || "").trim();
  if (!c) return "";
  return `Cast sheet (author-maintained — keep every name, role, relationship, and voice consistent with it):\n${c}`;
}

// Author-pinned canon: hand-maintained facts that outrank the model-kept notes.
function bibleBlock(bible) {
  const b = String(bible || "").trim();
  if (!b) return "";
  return `Author-pinned canon (authoritative — never contradict these; if they conflict with any other note, the canon wins):\n${b}`;
}

// A sample passage whose voice the prose should match (style only, not content).
function voiceBlock(sample) {
  const v = String(sample || "").trim();
  if (!v) return "";
  return [
    "A sample passage whose VOICE and texture to match — study its rhythm, diction, and sentence shapes. Match the style only; never reuse its content, characters, or events:",
    "----------",
    v,
    "----------",
  ].join("\n");
}

/**
 * Continue the manuscript in the established voice, aiming for ~targetWords.
 * The model is given a cumulative continuity record (so early characters and
 * details from chapters far behind the recent window aren't forgotten), the
 * book's opening, and the most recent passages. Returns plain prose only.
 */
export async function continueStory({ title, author, settings, opening, recent, memory, whole, arc, sections, targetWords, bible, cast, voiceSample, position, variety, variant, digest, plan, lens, onDelta }) {
  const target = Math.max(20, Math.min(2000, targetWords || 150));
  const maxTokens = Math.min(4096, Math.round(target * 2.2) + 256);

  const system = [
    "You are a co-author silently continuing someone else's novel-in-progress.",
    whole
      ? "You will be given the complete manuscript so far. Continue the story from exactly where it ends."
      : "You will be given continuity notes, the book's opening, and the most recent passage. Continue the story from exactly where the most recent passage ends.",
    "",
    "Hard rules:",
    "- Match the established voice, tense, point of view, diction, pacing, and genre. Do not reset or 'improve' the style.",
    "- Honor established continuity: keep character names, relationships, locations, timeline, and planted details consistent. Never rename characters, contradict earlier facts, or reintroduce someone as if new.",
    "- Continue the narrative forward. Do not summarize, recap, or restate what already happened.",
    `- Write approximately ${target} words — never more than ~15% over, and shorter is fine if the passage's work is done; do not pad to reach the count. This is a turn in a back-and-forth, not the whole rest of the book — leave room for the next writer.`,
    `- ${NATURAL_PROSE}`,
    `- Within the established voice: ${ECONOMY}`,
    `- ${PROPORTION}`,
    `- ${LOGIC}`,
    `- ${NATURAL_DIALOGUE}`,
    "- Output prose ONLY. No chapter headings (unless the manuscript itself uses them), no titles, no author's notes, no quotation framing, no markdown, no commentary about the writing.",
    "- Do not wrap the passage in quotes. Begin mid-flow if that is what the text calls for.",
  ].join("\n");

  // The editor's desk (see guideStory): a ranked ruling replaces the raw notes.
  const desk = splitPlan(plan);
  const ruled = desk.priorities.length > 0;
  const craft = ruled ? referenceNotes(memory) : craftNotes(memory);
  const pacing = ruled ? "" : pacingSteer(memory);
  if (ruled) {
    variety = "";
    lens = "";
  }
  const beatPlan = planBlock(ruled ? desk.beats : plan);
  const steer = ruled ? prioritiesBlock(desk.priorities) : arcBlock(arc, sections);
  const voice = voiceBlock(voiceSample);
  let content;
  if (whole) {
    const titleLine = `Working title: "${title}"  ·  Primary author: ${author}`;
    // Append-only cached prefix — the closing delimiter opens the tail (see
    // cachedUserContent) so the previous turn's cache entry stays a valid prefix.
    const manuscript = [
      voice,
      "The complete manuscript so far (continue directly from the very end; keep every character, place, and fact consistent with it):",
      "----------",
      whole,
    ]
      .filter(Boolean)
      .join("\n");
    const tail = [
      "----------",
      bibleBlock(bible),
      castSheetBlock(cast),
      craft,
      pacing,
      position || "",
      variety || "",
      lens || "",
      beatPlan,
      steer,
      variant || "",
      `Now write the next ~${target} words, continuing seamlessly.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    content = cachedUserContent(titleLine, manuscript, tail);
  } else {
    const mem = memoryBlock(memory);
    const titleLine = `Working title: "${title}"  ·  Primary author: ${author}`;
    const manuscript = [
      voice,
      opening
        ? `How the book opens (for founding voice & characters — do NOT continue from here):\n----------\n${opening}\n----------`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const tail = [
      mem ? `Continuity notes (for consistency — do NOT copy verbatim into the prose):\n${mem}` : "",
      digestBlock(digest),
      bibleBlock(bible),
      castSheetBlock(cast),
      craft,
      pacing,
      "Most recent passage of the manuscript (continue directly from the end of this):",
      "----------",
      recent,
      "----------",
      "",
      position || "",
      variety || "",
      lens || "",
      beatPlan,
      steer,
      variant || "",
      `Now write the next ~${target} words, continuing seamlessly and consistently with everything above.`,
    ]
      .filter(Boolean)
      .join("\n");
    content = cachedUserContent(titleLine, manuscript, tail);
  }

  const text = await runText(
    tuned(
      {
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
      },
      0.92
    ),
    onDelta
  );
  if (!text) throw new Error("The AI author returned an empty continuation.");
  return text;
}

const wc = (t) => (String(t || "").trim().match(/\S+/g) || []).length;

// The voice constraints for a section-level pass: the guide-mode style contract,
// or (in participate mode) strict preservation of whatever voice the text has.
function sectionVoiceRules(mode, guide) {
  const g = guide || {};
  return mode === "guide"
    ? [
        `- Prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
        `- Narrate in ${POV_TEXT[g.pov] || POV_TEXT.third_limited}, ${TENSE_TEXT[g.tense] || TENSE_TEXT.past}.`,
        `- ${maturityText(g)}`,
      ].join("\n")
    : "- Preserve the passage's established voice, point of view, tense, diction, and tone exactly.";
}

/**
 * Plan-then-write: a short private beat plan for the NEXT section, produced
 * before drafting so the prose has a shape to land — what the viewpoint
 * character wants here, what's in the way, what CHANGES by the end (every
 * section must shift something), what's withheld, and where it ends. Runs on
 * the analysis model with light adaptive thinking. Returns plain lines; empty
 * for tiny turns, where a plan would outweigh the prose.
 */
export async function planSection({ title, mode, guide, prompt, memory, digest, recent, position, bible, cast, arc, sections, targetWords, priorPlans, lens, sceneInstruction, brief, outline, audit, coldRead, variety }) {
  const target = Number(targetWords) || 0;
  if (target && target < 100) return "";
  const g = guide || {};
  const lead = mode === "guide" ? "the director's instruction" : "the human co-author's passage";
  const system = [
    "You are the novelist's private planning voice and the editor's desk in one: you sketch the beats of the NEXT section of a novel-in-progress before it is drafted, and you rule on which of the book's many notes matter for it. You output a plan, never prose.",
    "",
    "PART ONE — the beats. Write 6-9 short lines, each one beat or answer, plain text, no headings, no markdown, no numbering. The FIRST line is the WEIGHT line; cover the rest in whatever order serves the section:",
    "- WEIGHT: exactly one of `WEIGHT: PIVOTAL` (the section contains a turning point — a decision, confrontation, revelation, reversal, loss, or the payoff of something the story has been building to), `WEIGHT: CONNECTIVE` (it only moves people or information into position; nothing irreversible happens), or `WEIGHT: STANDARD`. Be honest — the label sets the section's length: a pivotal section gets extra room, a connective one is written short. Most sections are not pivotal. After the label, name the ONE beat that gets the most words.",
    "- WANT: what the viewpoint character wants in this section, concretely — and what they will do to get it.",
    "- OBSTACLE: what stands in the way (a person, a fact, themselves), and how it pushes back.",
    "- CHANGE: what is different by the end — a value that shifts (safe→unsafe, trust→doubt, ignorance→knowledge), a relationship, or what the reader knows. Every section must change something; if the instruction implies none, find the change inside it.",
    "- WITHHELD: one thing the section deliberately does not say or resolve.",
    "- ENDING: the concrete image, line, or action the section ends on — not a tidy summing-up.",
    "- CUT: what the section skips or compresses to a clause — travel, arrivals, small talk, re-describing a place or person the book has already shown, anything nobody needs to watch.",
    "- LOGIC: check the section against what is established — how each character involved comes to know what they act on, why this happens now and not earlier, and anything the section needs that the story has not yet set up (with the one-sentence bridge that supplies it). If nothing needs bridging, say so in three words.",
    "",
    "Rules:",
    mode === "guide"
      ? "- Serve the director's instruction; the plan makes it land, it does not replace it. Do not invent major new events, characters, or twists the instruction did not ask for."
      : "- Serve the human co-author's most recent passage: plan a continuation that answers it, in the same register and scale. Do not seize the plot.",
    "- Be concrete and specific to THIS story — names, objects, places. No generic craft advice.",
    "- Pay off a planted setup only if the story is ready; otherwise leave it alone.",
    "- Never plan a turning point as something that happens offstage, between sections, or in summary. If the instruction reaches a turning point, the plan stays inside it; if the instruction packs in more than one, give the room to the one that matters most and let the others take a line each.",
    "- If open logic gaps are listed and one can be closed naturally here, plan the line that closes it. Never plan a beat that depends on a coincidence or on knowledge a character had no way to get.",
    "- Do not repeat the shape of the previous sections' plans if they are shown.",
    mode === "guide" ? `- Narrative POV: ${POV_TEXT[g.pov] || POV_TEXT.third_limited}.` : "",
    "",
    `PART TWO — the ruling. After the beat lines, write the line \`PRIORITIES:\` and under it 2-${MAX_PRIORITIES} numbered lines. You are shown every note on this book: the author's brief, the rolling outline, the last chapter's audit, open logic gaps, planted setups, where recent sections spent their words, the pacing verdict, the editor's concern, a fresh reader's reactions, the long-range headings, variety notes, and what readers of the genre reward and punish — whichever of these exist. The writer will see NONE of them: only your beats and these lines, plus the facts (canon, cast, continuity, the recent prose). So decide what actually matters for THIS section and say it:`,
    "- Rank by consequence for this section, most important first. Begin each line with MUST (the section fails without it), AVOID (a specific trap this section is at real risk of), or KEEP (a lighter thing worth holding in mind).",
    `- Most notes do not apply to this section — leave those out entirely. A note earns a line only if it changes what happens here or how it is told. Fewer, sharper lines beat coverage; never more than ${MAX_PRIORITIES}.`,
    "- Make every line specific to this story and this section: name the character, the object, the gap, the setup. Translate the note into the act — not \"mind the pacing\" but \"the plot has been racing: let the argument at the gate run its full length\". Each line under ~40 words.",
    `- When notes pull against each other, this order decides: ${lead}; established facts, canon and logic; the author's brief; the rolling outline; open logic gaps and planted setups; pacing and proportion; what readers of the genre expect; variety.`,
    `- ${lead[0].toUpperCase() + lead.slice(1)} always wins. If it departs from the outline or the brief, plan the section it asks for and do not steer back; the outline will be revised around it.`,
    "- Do not repeat a beat line as a priority, and do not restate standing craft rules the writer already has (show don't tell, vary rhythm). If nothing beyond the beats matters, write a single KEEP line.",
    sceneInstruction ? `\nLAST LINE — ${sceneInstruction.replace(/^-\s*/, "")}` : "",
    "",
    "Output the beat lines, then PRIORITIES and its lines" + (sceneInstruction ? ", then the SCENES line" : "") + " — nothing else.",
  ]
    .filter((l) => l !== false && l != null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  const mem = memoryBlock(memory);
  const open = openLedgerLines(memory && memory.ledger);
  const pacing = pacingSteer(memory);
  const concerns = concernLines(memory);
  const fresh =
    coldRead && coldRead.cold && (coldRead.cold.confused || coldRead.cold.skimmed)
      ? [
          `A fresh reader given only chapter ${coldRead.num} reported:`,
          coldRead.cold.confused ? `Confused: ${coldRead.cold.confused}` : "",
          coldRead.cold.skimmed ? `Skimmed: ${coldRead.cold.skimmed}` : "",
          coldRead.cold.wanted ? `Wanted next: ${coldRead.cold.wanted}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";
  const user = [
    `Working title: "${title}"`,
    mem ? `Continuity notes:\n${mem}` : "",
    digestBlock(digest),
    bibleBlock(bible),
    castSheetBlock(cast),
    brief || "",
    outline || "",
    audit || "",
    concerns.length
      ? `The editor's current concern with the story — what is holding it back, most serious first. Plan this section to work against whichever of these its events can honestly answer, and say so in the priorities:\n${concerns.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "",
    fresh,
    open.length ? `Planted setups awaiting payoff:\n${open.join("\n")}` : "",
    noteLines(memory && memory.holes, 6).length
      ? `Open logic gaps flagged by the editor (close one if this section can do it naturally; never widen one):\n${noteLines(memory.holes, 6).join("\n")}`
      : "",
    noteLines(memory && memory.balance, 3).length
      ? `How recent sections spent their words (SLACK / RUSHED) — plan against the pattern:\n${noteLines(memory.balance, 3).join("\n")}`
      : "",
    recent ? `Most recent prose (the section will continue from the end of this):\n----------\n${recent}\n----------` : "",
    position || "",
    arcBlock(arc, sections),
    Array.isArray(priorPlans) && priorPlans.length
      ? `The previous sections' plans (do not repeat their shape):\n${priorPlans.map((p) => `---\n${p}`).join("\n")}`
      : "",
    lens || "",
    pacing || "",
    variety || "",
    mode === "guide"
      ? `The director's instruction for the next section:\n"""${prompt}"""`
      : "Plan the AI co-author's next continuation.",
    target
      ? `The section's nominal length is about ${target} words — roughly ${weightedTarget(target, "PIVOTAL")} if you label it PIVOTAL, ${weightedTarget(target, "CONNECTIVE")} or fewer if CONNECTIVE.`
      : "",
    "",
    "Write the beat plan and the ruling now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Weighing a dozen kinds of note against one section is a judgment call, so
  // the desk thinks a little harder than the beat sketch alone used to.
  const text = await runText(
    withThinking(
      { model: ANALYSIS_MODEL, max_tokens: 6000, system, messages: [{ role: "user", content: user }] },
      "medium"
    )
  );
  return String(text || "")
    .replace(/^```[\s\S]*?\n|```$/g, "")
    .trim()
    .slice(0, 3200);
}

/**
 * Hierarchical memory: a once-only summary of one CLOSED chapter — events in
 * order, what changed, new facts and characters, threads opened and closed,
 * and how it ends. Cached by the caller against the chapter's fingerprint.
 */
export async function summarizeChapter({ title, num, chapterTitle, text, prior }) {
  const system = [
    "You are keeping the working memory of a novel-in-progress: write a compact, factual summary of ONE chapter so that later chapters can be written consistently with it without re-reading it.",
    "Write 120-200 words of plain prose (one paragraph, no headings, no bullets, no markdown). Include, in order: the events as they happen; every character who appears (with full names) and anything newly established about them; new places, objects, and facts; what changes by the end of the chapter; any thread, question, or setup that is opened or resolved; and the exact situation the chapter ends on.",
    "Be precise and literal — names, numbers, who knows what. No interpretation, no praise, no critique.",
  ].join("\n");
  const user = [
    `Working title: "${title}"`,
    prior ? `Summary of the chapters before this one (for names and context; do not restate them):\n${prior}` : "",
    `Chapter ${num}${chapterTitle ? ` — ${chapterTitle}` : ""}:`,
    "----------",
    text,
    "----------",
    "",
    "Write the chapter summary now.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const out = await runText(
    tuned({ model: ANALYSIS_MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] }, 0.2)
  );
  return String(out || "").trim().slice(0, 1600);
}

/**
 * Cold read: a context-free reader takes ONE chapter with no memory of the
 * book and reports where they were confused, where they skimmed, and what they
 * wanted to know — the signals an all-knowing editor can never produce.
 * Returns { confused, skimmed, wanted, grip } (strings; grip 1-10 or null).
 */
export async function coldReadChapter({ num, text }) {
  const system = [
    "You are a sharp, honest reader. You have been handed ONE chapter of a novel with NO other context — you have not read what came before and know nothing about the book. Read it as a reader, not an editor: notice what you actually experienced.",
    "Respond with exactly four lines, in this order, each starting with the label shown. Plain text only — no markdown, no extra lines.",
    "Confused: where you lost the thread or could not tell who/what/why — quote or name the specific moment(s). If nothing, write 'Nothing.'",
    "Skimmed: where your attention slid — the passages you would skip on a second read, and why (static, repetitive, over-described). If nothing, write 'Nothing.'",
    "Wanted: the question or feeling this chapter left you needing the next one to answer. One or two sentences.",
    "Grip: an integer 1-10 for how strongly this chapter, on its own, would keep a stranger reading.",
    "Do not comment on prose style or craft technique — report your experience as a reader. Do not assume the earlier chapters explained things; if this chapter is confusing without them, say so — that is useful.",
  ].join("\n");
  const user = [`Chapter ${num}:`, "----------", text, "----------", "", "Give your four lines now."].join("\n");
  const raw = await runText(
    tuned({ model: ANALYSIS_MODEL, max_tokens: 700, system, messages: [{ role: "user", content: user }] }, 0.3)
  );
  const pick = (label) => {
    const m = String(raw || "").match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"));
    return m ? m[1].trim().slice(0, 600) : "";
  };
  const gripNum = parseInt((pick("Grip").match(/\d+/) || [""])[0], 10);
  return {
    confused: pick("Confused"),
    skimmed: pick("Skimmed"),
    wanted: pick("Wanted"),
    grip: Number.isFinite(gripNum) ? Math.min(10, Math.max(1, gripNum)) : null,
  };
}

// Leniently extract a JSON object from a model reply (fences, preamble, etc).
function parseJsonObject(raw) {
  const t = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const f = t.indexOf("{");
  const l = t.lastIndexOf("}");
  if (f === -1 || l <= f) return null;
  try {
    const obj = JSON.parse(t.slice(f, l + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

/**
 * The brief: PROPOSE the book's stated aims from what has been written so far —
 * premise, promise to the reader, the shape of the ending, themes, what it must
 * not become, and a target length. A proposal only: the author confirms or
 * rewrites it before it is ever used in a prompt. Returns a clamped,
 * unconfirmed brief, or null.
 */
export async function suggestBrief({ title, fullText, digest, synopsis, genre, arc, mode, totalWords }) {
  const system = [
    "You are a book editor writing the one-page brief for a novel-in-progress: a plain statement of what this book is trying to be, inferred from what has been written so far. The author will correct it — so commit to a reading rather than hedging, and stay inside what the pages actually support.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences. Keys:",
    '  "premise": 1-2 sentences — who wants what, what stands in the way, and why it matters. Concrete: names, the place, the pressure.',
    '  "promise": 1-2 sentences — what this book owes its reader: the kind of story it has announced itself to be, the experience and the questions it has promised to answer.',
    '  "ending": 1-2 sentences — the SHAPE of the ending the story is pointing at: what is won, lost, or understood, and at what cost. A direction, not a plot twist; never invent a surprise the pages do not set up.',
    '  "themes": a short phrase or two — what the book keeps circling.',
    '  "avoid": one sentence — what this book must not turn into (the easy version of itself, the genre it could slide into).',
    '  "targetWords": an integer — a sensible finished length for a story of this scale and pace (a short story 5000-15000, a novella 20000-45000, a novel 60000-110000).',
  ].join("\n");
  const goals = (Array.isArray(arc) ? arc : []).filter((h) => h && h.text).map((h) => `- ${h.text}`);
  const user = [
    `Working title: "${title}"`,
    genre ? `Genre (as read so far): ${genre}` : "",
    synopsis ? `Synopsis so far: ${synopsis}` : "",
    goals.length ? `The author's own heading goals (take these as given):\n${goals.join("\n")}` : "",
    mode === "guide" ? "The author directs this book section by section; the brief should describe the book their directions are making." : "",
    totalWords ? `Written so far: about ${totalWords} words.` : "",
    digest ? `Chapter-by-chapter digest:\n${digest}` : "",
    "The manuscript (opening and most recent material; the middle may be omitted):",
    "----------",
    fullText,
    "----------",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const reply = await complete(
    withThinking(
      tuned({ model: ANALYSIS_MODEL, max_tokens: 5000, system, messages: [{ role: "user", content: user }] }, 0.4),
      "low"
    )
  );
  return clampBrief(parseJsonObject(reply), { confirmed: false });
}

/**
 * The chapter audit: a deep read of ONE chapter at the moment it closes, on
 * the stronger model with thinking. It says what the chapter did for the
 * story, holds it against the author's brief and the outline, places the book
 * against its planned length, names the consequences the next chapter must
 * pick up — and RULES on every suspected plot hole (confirmed / repaired /
 * dismissed), reading the full chapter text the per-section analyzer only
 * ever sees an excerpt of. Returns a normalized audit, or null.
 */
export async function auditChapter({ title, num, chapterTitle, text, prior, brief, outlineEntry, holes, ledger, bible, cast, continuity, position, final }) {
  const suspected = Array.isArray(holes) ? holes : [];
  const system = [
    "You are a rigorous developmental editor auditing ONE chapter of a novel-in-progress at the moment it closes. You have the whole chapter in front of you, a digest of every chapter before it, and the book's standing notes. Read the chapter closely, then report. Judge the STORY — what happens, why, and what it costs — not the prose style.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences. Keys:",
    '  "accomplished": 1-2 sentences — what this chapter actually did for the story: what is different at its end (a decision made, something learned, a relationship changed, a door closed). If it changed little, say so plainly.',
    brief
      ? '  "aims": Hold the chapter against the author\'s brief. Begin with exactly one of ON COURSE, DRIFTING, or OFF COURSE, then a short reason (under ~30 words) naming what in the chapter serves the brief or pulls away from it.'
      : '  "aims": "" (no brief has been set).',
    outlineEntry
      ? '  "outline": Hold the chapter against what the outline planned for it. Begin with exactly one of DELIVERED, PARTLY, or DIVERGED, then what was and was not delivered (under ~30 words). Diverging is not a fault if the chapter is better for it — say which.'
      : '  "outline": "" (the outline had no entry for this chapter).',
    '  "position": 1-2 sentences — where the BOOK now stands structurally: what has been set in motion, what turn should come next, and whether the story is early, on time, or late for its length (use the length position if one is given).',
    final
      ? '  "carry": "" (this is the final chapter).'
      : '  "carry": 1-3 short lines, newline-separated — the consequences of THIS chapter that the next chapter must pick up and may not ignore (who now knows what, what was promised, broken, or left in whose hands).',
    suspected.length
      ? '  "holes": The editor has SUSPECTED the numbered logic gaps listed below. Rule on EVERY one, as an array of {"n": <its number>, "status": "confirmed" | "repaired" | "dismissed", "note": "<under 25 words: the evidence>"}. "repaired" = the text (this chapter or the digest) now supplies the missing cause, knowledge, or consequence. "dismissed" = it was never a real gap: the text does explain it, or it is a mystery the story is deliberately withholding. "confirmed" = a careful reader would still catch it. Check the text before ruling — do not confirm from the description alone.'
      : '  "holes": [] (no gaps were suspected).',
    '  "newHoles": up to 3 strings — logic gaps in THIS chapter that are not already listed: a character acting on knowledge they had no way to get; a motive that flips without cause; a problem solved by coincidence or sudden competence; an impossible timeline; an object, injury, or constraint that silently vanished; a consequence that should have followed and did not. Each names the specific moment and what is missing (under ~25 words). Only gaps a careful reader would catch — an empty array if there are none. Never list a deliberate mystery or a matter of taste.',
    "Be exact and unsparing; this audit decides what the next chapter is asked to fix.",
  ].join("\n");
  const open = openLedgerLines(ledger);
  const user = [
    `Working title: "${title}"`,
    brief || "",
    position || "",
    prior ? `The book before this chapter, chapter by chapter:\n${prior}` : "This is the first chapter.",
    continuity ? `Continuity record (established characters, places, facts):\n${continuity}` : "",
    bibleBlock(bible),
    castSheetBlock(cast),
    open.length ? `Planted setups awaiting payoff:\n${open.join("\n")}` : "",
    outlineEntry ? `What the outline planned for this chapter: ${outlineEntry}` : "",
    suspected.length ? `Suspected logic gaps — rule on each:\n${suspected.map((h, i) => `${i + 1}. ${h}`).join("\n")}` : "",
    `Chapter ${num}${chapterTitle ? ` — ${chapterTitle}` : ""}${final ? " (the final chapter)" : ""}:`,
    "----------",
    text,
    "----------",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const reply = await complete(
    withThinking(
      tuned({ model: AUDIT_MODEL, max_tokens: 12000, system, messages: [{ role: "user", content: user }] }, 0.2),
      "high"
    )
  );
  return normalizeAudit(parseJsonObject(reply), suspected);
}

/**
 * The rolling outline: plan the chapter now being written and the few after
 * it, from where the story actually stands — the digest, the last audit, the
 * open gaps and setups, the author's brief and heading goals. Entries the
 * author has pinned are fixed points to plan around. Returns
 * { through, chapters: [{ num, title, summary }] } (unmerged), or null.
 *
 * With `endgame` it plans the WHOLE rest of the book instead — every chapter
 * from here to the last one — for "Finish the book". `endgame.chapters` is the
 * count to aim for on a first plan (0 = let the story decide); `endgame.lastNum`
 * is the ceiling once a plan exists (the book may end sooner, never later).
 */
export async function reviseOutline({ title, mode, currentNum, brief, digest, audit, synopsis, holes, ledger, critique, arc, sections, pinned, previous, position, recent, endgame, shortfall }) {
  const fixed = Array.isArray(pinned) ? pinned : [];
  const eg = endgame && typeof endgame === "object" ? endgame : null;
  const egLast = eg ? Math.min(currentNum + ENDGAME_MAX - 1, Math.max(0, Math.round(Number(eg.lastNum)) || 0)) : 0;
  const egAim = eg ? Math.min(ENDGAME_MAX, Math.max(0, Math.round(Number(eg.chapters)) || 0)) : 0;
  const egCount = egLast
    ? `The plan already in force ends the book at chapter ${egLast}. Keep to that or end a chapter SOONER if the story has landed — never later, and never by adding a chapter.`
    : egAim
      ? `Aim for about ${egAim} chapter${egAim > 1 ? "s" : ""} including this one (the planned length allows roughly that) — one or two fewer or more if the story honestly needs it, never fewer than ${ENDGAME_MIN} and never more than ${ENDGAME_MAX}.`
      : `Use as many chapters as the story honestly needs to land its ending — usually between 4 and 12, never fewer than ${ENDGAME_MIN} and never more than ${ENDGAME_MAX}. Do not pad, and do not rush an ending the pages have not earned.`;
  const system = [
    eg
      ? "You are the developmental editor drawing up the ENDGAME OUTLINE of a novel-in-progress: the plan for EVERY remaining chapter, from the one now being written to the last page. An autopilot will write the rest of the book from this plan, chapter by chapter, so it must be complete: the last entry is the final chapter, and when it closes the book is finished."
      : "You are the developmental editor keeping the ROLLING OUTLINE of a novel-in-progress: a short working plan for the chapter now being written and the few after it. It is redrawn every time a chapter closes, from where the story actually stands — not from where an earlier plan hoped it would be.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences. Keys:",
    '  "through": 1-2 sentences — the through-line from here to the ending: what the remaining book has to accomplish.',
    eg
      ? `  "chapters": an array with one entry for EVERY remaining chapter, starting at chapter ${currentNum} and numbered consecutively through the FINAL chapter. Each: {"num": <chapter number>, "title": "<a working title, 2-5 words>", "summary": "<1-2 sentences, under ~45 words: what happens AND what it changes — the turn the chapter exists to deliver>", "detail": "<a fuller overview of the chapter, 4-6 sentences, about 80-130 words: where it opens, the main movements in order, who drives each, what is revealed or decided, which open setup or gap it pays off, and the situation it ends on>"}. ${egCount}`
      : `  "chapters": an array of 3-${OUTLINE_MAX - 1} entries, starting at chapter ${currentNum} and numbered consecutively. Each: {"num": <chapter number>, "title": "<a working title, 2-5 words>", "summary": "<1-2 sentences, under ~45 words: what happens AND what it changes — the turn the chapter exists to deliver>"}.`,
    "Rules:",
    eg
      ? "- This plan must FINISH the book. Before you write it, list for yourself everything still open — the central question, every planted setup awaiting payoff, every open logic gap, every heading goal, each main character's unfinished business — and give each one a chapter where it is paid off or deliberately, visibly left open. Nothing important may be resolved off the page or left for a chapter that does not exist."
      : "",
    eg
      ? "- Shape the run-in: pressure rises chapter over chapter to a climax in which the central conflict is decided by the protagonist's own choice and at a real cost; then a short resolution that shows what the ending changed. The final chapter's summary must state how the book ends — the last turn and the closing situation — in keeping with the shape of the ending in the author's brief."
      : "",
    eg && !egLast
      ? `- This is the plan for the WHOLE rest of the book, not for the next chapter. One entry per chapter: a one-line summary plus a fuller overview. The overview is still a chapter-level plan in flowing sentences — not a list of sections or scenes; those are worked out later, when the chapter is written. An answer holding only the current chapter is wrong: return at least ${ENDGAME_MIN} entries, the last of them the final chapter.`
      : "",
    eg ? "- Introduce no major new character, power, or problem in the last third of these chapters; the ending is built from what the book already holds." : "",
    "- Every chapter must turn something: a decision, a discovery, a reversal, a cost paid. No chapter that only moves people into position.",
    "- Build from consequences. The first entry must pick up what the last chapter left unresolved; each later entry should follow from the one before, not merely come after it.",
    "- Use what is already planted: pay off open setups before inventing new ones, and close open logic gaps where a chapter can do it naturally. Do not solve anything by coincidence.",
    criticismLines(critique).length
      ? eg
        ? "- The editor's criticism (given below) says what is holding the book back. The remaining chapters are the only place left to put it right: take the points one by one and give each a chapter that answers it through what happens — a want made visible, a stake made concrete and costly, a rushed turn given its scene, a dropped thread picked up — and say in that chapter's overview how. Do not answer a point by having someone explain it, and leave a point alone only if answering it would break the brief or the canon."
        : "- The editor's criticism (given below) says what is holding the book back. Plan the coming chapters to put it right through what happens in them — not by explanation — wherever the story honestly allows."
      : "",
    brief
      ? eg
        ? "- The author's brief is the destination and it is binding: deliver the promise to the reader, arrive at the shape of ending it describes, keep circling its themes, and never turn into what it says the book must not become."
        : "- The author's brief is the destination: steer toward its ending and keep its promise. Pace against the planned length — if the book is in its final stretch, the outline must reach the ending within these entries and say which chapter is the last."
      : eg
        ? "- No brief has been set: end the book the story itself has been pointing at — the ending its opening promised — rather than inventing a new destination."
        : "- No brief has been set: follow the direction the story itself is taking, and do not force an ending the pages have not earned.",
    fixed.length
      ? eg
        ? "- Entries marked FIXED were set by the author. Return their title and summary unchanged under the same chapter numbers, write each one's overview to fit the author's line exactly, and plan the other chapters around them."
        : "- Entries marked FIXED were set by the author. Return them unchanged under the same chapter numbers and plan the other chapters around them."
      : "",
    eg
      ? "- The author will read this plan before any of it is written and may change it; make each summary definite enough to write from."
      : mode === "guide"
        ? "- The author directs this book one section at a time and may take it anywhere; this outline is a proposal for them, so keep it open enough to steer."
        : "- This book is co-written turn by turn with a human author; outline the direction, not their lines.",
    "- Concrete and specific to THIS story — names, places, objects. No generic structure talk (no 'rising action', no 'midpoint').",
  ]
    .filter(Boolean)
    .join("\n");
  const open = openLedgerLines(ledger);
  const gaps = noteLines(holes, 6);
  const user = [
    `Working title: "${title}"`,
    brief || "",
    position || "",
    synopsis ? `Synopsis so far: ${synopsis}` : "",
    digest ? `The book so far, chapter by chapter:\n${digest}` : "",
    audit || "",
    arcBlock(arc, sections),
    open.length ? `Planted setups awaiting payoff:\n${open.join("\n")}` : "",
    gaps.length ? `Open logic gaps:\n${gaps.join("\n")}` : "",
    criticismBlock(critique),
    recent ? `The latest prose (chapter ${currentNum} so far, or the end of the last chapter):\n----------\n${recent}\n----------` : "",
    previous
      ? eg && egLast
        ? `The plan in force (revise the chapters still to come in light of what the last chapter actually did — keep what still holds, change what no longer follows):\n${previous}`
        : `The previous outline (drawn up before the last chapter was written — revise it, do not just renumber it):\n${previous}`
      : "",
    fixed.length
      ? `FIXED entries set by the author:\n${fixed.map((e) => `ch ${e.num}${e.title ? ` — ${e.title}` : ""}: ${e.summary}`).join("\n")}`
      : "",
    `The chapter now being written is chapter ${currentNum}.`,
    eg && shortfall
      ? `Your previous answer covered only ${shortfall} chapter${shortfall > 1 ? "s" : ""}, or skipped chapter numbers. That is not a plan to the end of the book. Return one entry for EVERY chapter from chapter ${currentNum} to the final chapter — at least ${ENDGAME_MIN}.`
      : "",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const reply = await complete(
    withThinking(
      tuned({ model: ANALYSIS_MODEL, max_tokens: eg ? 14000 : 8000, system, messages: [{ role: "user", content: user }] }, 0.5),
      "medium"
    )
  );
  const parsed = parseJsonObject(reply);
  return sanitizeOutline(parsed && eg ? { ...parsed, toEnd: true } : parsed);
}

/**
 * Finish the book: break ONE chapter of the endgame outline into the section
 * directions the autopilot will hand the writer, in order — the same kind of
 * instruction the author types to direct a section. Each direction says what
 * happens and what it changes; the per-section planner and the writer do the
 * rest. Returns an array of direction strings, or null (the caller falls back
 * to a plain split of the outline entry).
 */
export async function planChapter({ title, num, entry, through, next, brief, digest, audit, synopsis, holes, ledger, critique, arc, sections, bible, cast, recent, count, writtenWords, sectionWords, final, lastNum }) {
  const n = Math.max(1, Math.round(Number(count)) || 1);
  const resumed = Number(writtenWords) > 0;
  const system = [
    "You are the developmental editor of a novel that an autopilot is writing to its end from an agreed outline. Break ONE chapter of that outline into the directions for its sections, in order. Each direction is the instruction a director would give the novelist for one section: what happens in it and what it changes. You write directions, never prose.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences:",
    `  {"sections": ["<direction 1>", "<direction 2>", ...]} — exactly ${n} direction${n > 1 ? "s" : ""}. Each is 1-3 sentences, under ~70 words, concrete: who is present, what they want, what happens, and what is different when the section ends.`,
    "Rules:",
    "- Together the sections must deliver the chapter's planned turn — all of it, and nothing that belongs to a later chapter. The turn itself (the decision, discovery, confrontation, reversal) gets a section of its own; do not bury it in a section that also has to travel, arrive, and catch up.",
    resumed
      ? "- Part of this chapter is already written (its latest prose is given). Plan only what REMAINS: the first direction picks up exactly where the prose stops, and never re-stages what is already on the page."
      : "- The first direction opens the chapter in motion, from the consequences of the chapter before — not with a recap, a waking, or an arrival.",
    final
      ? "- This is the FINAL chapter of the book. The last direction ends the book: the central question is answered on the page, what is still open is paid off or deliberately left open in plain sight, and it names the final image or action to close on. No epilogue of summary, no new question."
      : "- The last direction ends the chapter on its changed situation and leaves the next chapter something it must deal with (the next chapter's plan is given so the hand-off is exact) — without writing that next chapter's events.",
    "- The chapter's plan and overview are high level. Go beyond them: invent the concrete scenes, obstacles, exchanges and reversals the chapter needs, so that every section has an event of its own. Never spread one planned beat thinly over several sections, and never give two sections the same job.",
    "- No overlap: each direction begins from the situation the one before it ends on and covers ground no other direction covers. A realisation, confrontation, decision or reveal happens in exactly one section.",
    "- Bias every direction toward action: it names something people DO — go, take, confront, refuse, find, break, say aloud — and an outward event that can be watched. Never a section whose business is someone reflecting, remembering, realising or coming to terms; if a change of mind matters, it happens through an act or an exchange with someone else.",
    "- Each section follows from the one before as a consequence, not merely the next thing. Skip travel, logistics, and anything nobody needs to watch.",
    "- Every section advances the plot: by its end something is decided, discovered, lost, or made irreversible. A section that only reacts to, discusses, or deepens the mood of what already happened is not a section.",
    "- Go through the open logic gaps and planted setups one by one and ask whether THIS chapter's people, place and events give a natural chance to close each. Where they do, give it to exactly one direction and name what closes it and how. Leave the ones this chapter cannot honestly reach, and anything the outline keeps for a later chapter.",
    criticismLines(critique).length
      ? "- Go through the editor's criticism (given below) point by point as well: it says what is holding the book back. Where this chapter's people and events can put a point right — a character's want shown in a choice, a stake made concrete, a turn given the room it was denied, a thread picked back up — build that into exactly one direction as something that HAPPENS, never as explanation. At least one direction must work against the most serious point this chapter can reach; do not bend the chapter's planned turn to do it."
      : "",
    "- Use what the book has planted: where this chapter can pay off an open setup or close an open logic gap naturally, say so in the direction that does it. Solve nothing by coincidence or sudden unexplained competence; if a section needs something the story has not set up, the direction says how it is bridged.",
    "- Stay inside the canon, the cast, and the author's brief. Keep the characters' established knowledge straight: nobody acts on what they have no way to know.",
    "- Directions are plot and intention only: no style advice, no word counts, no mention of the outline, the autopilot, the editor, or 'this section'.",
  ]
    .filter(Boolean)
    .join("\n");
  const open = openLedgerLines(ledger);
  const gaps = noteLines(holes, 6);
  const user = [
    `Working title: "${title}"`,
    brief || "",
    through ? `Through-line to the ending: ${through}` : "",
    synopsis ? `Synopsis so far: ${synopsis}` : "",
    digest ? `The book so far, chapter by chapter:\n${digest}` : "",
    audit || "",
    bibleBlock(bible),
    castSheetBlock(cast),
    arcBlock(arc, sections),
    open.length ? `Planted setups awaiting payoff:\n${open.join("\n")}` : "",
    gaps.length ? `Open logic gaps:\n${gaps.join("\n")}` : "",
    criticismBlock(critique),
    recent
      ? `${resumed ? `Chapter ${num} so far (about ${writtenWords} words; its latest prose)` : "The end of the previous chapter"}:\n----------\n${recent}\n----------`
      : "",
    `THE CHAPTER TO BREAK DOWN — chapter ${num}${final ? " (the final chapter)" : lastNum ? ` of ${lastNum}` : ""}${entry && entry.title ? ` — ${entry.title}` : ""}:\n${(entry && entry.summary) || ""}${entry && entry.detail ? `\nThe agreed overview of this chapter (follow it; the sections together must deliver all of it):\n${entry.detail}` : ""}`,
    next ? `The chapter after it (do NOT write this — it is here so the hand-off is exact): ch ${next.num}${next.title ? ` — ${next.title}` : ""}: ${next.summary}` : "",
    `Each section runs about ${Number(sectionWords) || 500} words. Return exactly ${n} direction${n > 1 ? "s" : ""}.`,
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const reply = await complete(
    withThinking(
      tuned({ model: ANALYSIS_MODEL, max_tokens: 6000, system, messages: [{ role: "user", content: user }] }, 0.5),
      "medium"
    )
  );
  return cleanDirections(parseJsonObject(reply), n);
}

/**
 * A short account of what ONE just-written section did, for the author watching
 * an auto run: how their live suggestion was handled (when they sent one), how
 * the plot moved, and what the section did about the editor's standing
 * criticism. Runs after the notes refresh. Returns
 * { steer, suggestion, plot, criticism } or null.
 */
export async function sectionReport({ title, text, direction, steer, critique, scoreFrom, scoreTo }) {
  const said = String(steer || "").trim();
  const points = criticismLines(critique);
  const system = [
    "You are the editor reporting on ONE section of a novel that an AI author has just written, for the author of the book, who is watching it being written. Report only what is actually on the page — plainly, specifically, without praise and without hedging.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences. Keys, all strings:",
    said
      ? '  "suggestion": 1-2 sentences, under ~45 words. The author sent a live suggestion for this section (given below). Say how the section handled it: start with exactly one of TAKEN UP, PARTLY, SET UP FOR LATER, or NOT ADDRESSED, then what on the page shows it — or, if it was not taken up, what the section did instead.'
      : "",
    '  "plot": 1-2 sentences, under ~45 words: what is different in the story at the end of this section that was not true at its start — what was decided, discovered, lost or made irreversible. If nothing moved, say so.',
    points.length
      ? '  "criticism": 1-2 sentences, under ~45 words. The editor\'s criticism as it stood BEFORE this section is given below. Say which point, if any, this section worked against and what on the page does it. If it answered none of them, say so plainly — do not stretch.'
      : '  "criticism": "" (there was no standing criticism).',
    "Name people, places and events from the section. Do not quote at length, do not advise, do not mention scores.",
  ]
    .filter(Boolean)
    .join("\n");
  const user = [
    `Working title: "${title}"`,
    direction ? `The direction the section was written to:\n${String(direction).split("\n")[0].slice(0, 400)}` : "",
    said ? `The author's live suggestion for this section:\n"${said}"` : "",
    points.length ? `The editor's criticism before this section — what was holding the book back:\n${points.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "",
    Number.isFinite(scoreFrom) && Number.isFinite(scoreTo) ? `(For context only: the editor's score went from ${scoreFrom} to ${scoreTo} after this section.)` : "",
    `THE SECTION:\n----------\n${String(text || "").slice(0, 16000)}\n----------`,
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const reply = await complete(tuned({ model: ANALYSIS_MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] }, 0.2));
  return cleanSectionReport(parseJsonObject(reply), { steer: said });
}

/**
 * Optional per-section polish: one careful line-editing pass over a freshly
 * generated section before it's committed. A polish, never a rewrite — story
 * events, facts, and length stay put; the sentences get better.
 */
export async function selfEditSection({ title, mode, guide, draft, memory, lint, lens, onDelta }) {
  const target = Math.max(20, wc(draft));
  const maxTokens = Math.min(8192, Math.round(target * 2.2) + 256);

  const adultRules = adultWriterRules(guide);
  const system = [
    "You are the novelist giving a just-written passage ONE careful line-editing pass before it goes into the book. This is a polish, not a rewrite.",
    "",
    "Hard rules:",
    "- Keep every story event, fact, name, and the meaning of every line of dialogue intact. Add no plot; remove no plot.",
    `- The polished passage must not be longer than the original (~${target} words) and may be up to a quarter shorter. Tighter is the goal; never pad back up to the original length.`,
    "- Improve the sentences: vary rhythm and length, cut filler and reflexive thematic summing-up, fix clunky or repetitive phrasing.",
    "- Cut what has not earned its words: description of something already established or that the viewpoint character would not register in this moment; stacked modifiers and paired adjectives; a second simile in a paragraph; a sentence that tells the reader what the previous one showed; interior commentary that restates the dialogue; filter phrases (\"she saw\", \"he felt\", \"seemed to\", \"began to\"); scene-setting before anything happens.",
    "- Do NOT trim the passage's pivotal beat — the decision, confrontation, or revelation it turns on. Tighten everything around it so it stands out; if it is the only thing given too few words, leave the length alone.",
    "- If a do-not-reuse imagery list is provided, replace any phrase in the passage that reuses or closely echoes an entry.",
    sectionVoiceRules(mode, guide),
    adultRules ? `- ${adultRules}` : "",
    `- ${NATURAL_PROSE}`,
    `- If the passage already reads well, change very little — a light hand beats a heavy one${polishException(guide) || "."}`,
    "- Output the final prose ONLY — no notes, no commentary, no markdown, no explanation of what changed.",
  ]
    .filter(Boolean)
    .join("\n");

  const craft = craftNotes(memory, { story: false });
  const lintLines = Array.isArray(lint) && lint.length
    ? `A mechanical scan flagged these specific tells in the passage — repair each one:\n${lint
        .map((l) => `- ${l}`)
        .join("\n")}`
    : "";
  const user = [
    `Working title: "${title}"`,
    craft,
    lintLines,
    lens || "",
    "The passage to line-edit:",
    "----------",
    draft,
    "----------",
    "",
    "Write the polished passage now.",
  ]
    .filter(Boolean)
    .join("\n");

  const text = await runText(
    tuned({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }, 0.6),
    onDelta
  );
  if (!text) throw new Error("The polish pass came back empty.");
  return text;
}

/**
 * Targeted rewrite: revise ONE existing passage per the author's instruction so
 * it still sits seamlessly between its surrounding text. Returns prose only.
 */
export async function rewritePassage({
  title,
  author,
  mode,
  guide,
  instruction,
  length, // 'shorter' | 'same' | 'longer'
  scope, // 'light' | 'free'
  before,
  passage,
  after,
  memory,
  bible,
  cast,
  lens,
  onDelta,
}) {
  const target = Math.max(20, wc(passage));
  const expected = length === "longer" ? Math.round(target * 1.4) : length === "shorter" ? Math.round(target * 0.7) : target;
  const maxTokens = Math.min(8192, Math.round(expected * 2.6) + 512);

  const lengthRule =
    length === "shorter"
      ? `- Make the rewrite noticeably SHORTER than the original — cut roughly a quarter to a third (aim for ~${expected} words). Cut by tightening the telling, not by dropping story events.`
      : length === "longer"
      ? `- EXPAND the passage — roughly a third to a half longer (aim for ~${expected} words). Add substance — the central exchange played out more fully, a complication, a reaction, a consequence — never description for its own sake, and never padding.`
      : `- Keep roughly the passage's current length (~${target} words, within about 20%) unless the instruction asks otherwise.`;
  const scopeRule =
    scope === "free"
      ? "- You have a FREE HAND within this passage: you may restructure it, cut or add beats, and change how its events unfold — provided it still flows seamlessly from the text before and into the text after, and contradicts nothing established elsewhere."
      : "- LIGHT TOUCH: keep every story event, fact, and the passage's structure intact — improve the telling, not the tale.";

  const adultRules = adultWriterRules(guide);
  const system = [
    "You are revising ONE passage inside a novel-in-progress, at the author's request.",
    "",
    "Hard rules:",
    "- Rewrite ONLY the marked passage. It must still read seamlessly out of the text before it and into the text after it — do not repeat, contradict, or re-set-up either.",
    "- Follow the author's instruction faithfully; it is the whole point of this rewrite.",
    scopeRule,
    lengthRule,
    "- Honor established continuity: names, relationships, locations, timeline, planted details.",
    sectionVoiceRules(mode, guide),
    adultRules ? `- ${adultRules}` : "",
    `- ${NATURAL_PROSE}`,
    `- ${economyRule(guide)}`,
    `- ${PROPORTION}`,
    `- ${LOGIC}`,
    `- ${NATURAL_DIALOGUE}`,
    "- Output the rewritten passage ONLY — no headings, notes, commentary, or markdown.",
  ]
    .filter(Boolean)
    .join("\n");

  const mem = memoryBlock(memory);
  const user = [
    `Working title: "${title}"  ·  Author: ${author}`,
    mem ? `Continuity notes (for consistency — do NOT copy verbatim):\n${mem}` : "",
    bibleBlock(bible),
    castSheetBlock(cast),
    before
      ? `The text immediately BEFORE the passage (unchanged — flow out of its ending):\n----------\n${before}\n----------`
      : "This passage opens the book.",
    `The passage to rewrite:\n----------\n${passage}\n----------`,
    after
      ? `The text immediately AFTER the passage (unchanged — your rewrite must flow into it):\n----------\n${after}\n----------`
      : "Nothing follows this passage yet.",
    lens || "",
    String(instruction || "").trim()
      ? `The author's instruction for the rewrite:\n"""${instruction}"""`
      : "The author gave no specific instruction — apply the length and scope rules above and simply make the passage better.",
    "",
    "Write the rewritten passage now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const text = await runText(
    tuned({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }, 0.85),
    onDelta
  );
  if (!text) throw new Error("The rewrite came back empty.");
  return text;
}

/**
 * Two-takes judge: given two drafts of the same section, pick the one that
 * reads more like a human novelist wrote it. Cheap (analysis model, a few
 * output tokens); returns "A" or "B", defaulting to "A" on anything unclear.
 */
export async function pickTake({ title, a, b, adult }) {
  const system = [
    "You are a sharp fiction editor comparing two takes of the same section of a novel. Pick the take that reads more like a human novelist wrote it.",
    "Judge by: varied, natural sentence rhythm; freedom from AI tells (the \"not X, but Y\" contrast, rule-of-three lists, dramatic one-line paragraph buttons, stock body language, tidy aphoristic endings); specificity and surprise over safe competence; dialogue that sounds spoken; and coherent continuation of the story. Also weigh ECONOMY and PROPORTION: prefer the take that spends its words on the moment that matters — the decision, confrontation, or revelation played out in scene — over the take that spends them on lead-up, scenery, or reflection, and mark down padding, re-description, and anything that happens without a cause or relies on coincidence. A rougher take that sounds human beats a smoother take that sounds generated.",
    judgeNote({ adult }),
    "Respond with EXACTLY one character: A or B. No other text.",
  ]
    .filter(Boolean)
    .join("\n");
  const user = [
    `Title: "${title}"`,
    "",
    "TAKE A:",
    "----------",
    a,
    "----------",
    "",
    "TAKE B:",
    "----------",
    b,
    "----------",
    "",
    "Which take reads more human? Answer A or B.",
  ].join("\n");

  const reply = await complete(
    tuned({ model: ANALYSIS_MODEL, max_tokens: 4, system, messages: [{ role: "user", content: user }] }, 0)
  );
  const raw = reply.trim().toUpperCase();
  return raw.startsWith("B") ? "B" : "A";
}

// Leniently extract a JSON array from a model response (fences, preamble, etc).
function parseJsonArray(raw) {
  const t = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const f = t.indexOf("[");
  const l = t.lastIndexOf("]");
  if (f === -1 || l <= f) return [];
  try {
    const arr = JSON.parse(t.slice(f, l + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Consistency audit: scan the manuscript for internal contradictions —
 * measured against itself, the author's canon, and the cast sheet. Returns
 * [{ issue, quote, severity }], empty when the book holds together.
 */
export async function auditConsistency({ title, fullText, bible, cast, continuity }) {
  const system = [
    "You are a meticulous continuity editor auditing a novel manuscript for internal contradictions.",
    "Report ONLY genuine inconsistencies:",
    "- Contradicted facts: names, spellings, ages, physical traits, dates, places, distances, possessions.",
    "- Timeline impossibilities (day/night, seasons, travel time, event order).",
    "- Characters knowing things they could not yet know, or forgetting things they clearly know.",
    "- A character, object, or place that changes identity or teleports between scenes.",
    "- Violations of the author's pinned canon or the cast sheet (these are authoritative).",
    "Do NOT report style issues, plot weaknesses, loose ends, or things merely left unexplained — only contradictions.",
    "",
    'Respond with a JSON array ONLY (no prose, no fences). Each finding: {"issue": "<1-2 sentences naming BOTH conflicting points>", "quote": "<a 4-12 word excerpt copied VERBATIM from the later of the two conflicting passages, so it can be located by exact text search>", "severity": "major" | "minor"}.',
    "Order most severe first. At most 12 findings. If the manuscript is consistent, respond with [].",
  ].join("\n");

  const user = [
    `Working title: "${title}"`,
    bible ? `The author's pinned canon (authoritative):\n${bible}` : "",
    cast ? `The cast sheet (authoritative):\n${cast}` : "",
    continuity ? `The running continuity record (helpful, not authoritative):\n${continuity}` : "",
    "The manuscript:",
    "----------",
    fullText,
    "----------",
    "",
    "Return the JSON array now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const reply = await complete(
    tuned({ model: ANALYSIS_MODEL, max_tokens: 2200, system, messages: [{ role: "user", content: user }] }, 0)
  );
  return parseJsonArray(reply)
    .filter((f) => f && typeof f.issue === "string" && f.issue.trim())
    .slice(0, 12)
    .map((f) => ({
      issue: f.issue.trim().slice(0, 500),
      quote: typeof f.quote === "string" ? f.quote.trim().slice(0, 160) : "",
      severity: f.severity === "major" ? "major" : "minor",
    }));
}

/**
 * Cast suggestions: read the manuscript and propose character-sheet entries
 * for characters not already on the sheet. Returns [{ name, role, voice, notes }].
 */
export async function suggestCast({ title, fullText, continuity, voices, existing }) {
  const system = [
    "You maintain the cast sheet for a novel-in-progress. Read the manuscript and propose sheet entries for its significant characters.",
    'Respond with a JSON array ONLY (no prose, no fences). Each entry: {"name": "<as used in the text>", "role": "<who they are, ≤20 words>", "voice": "<how they talk — diction, rhythm, habits, ≤25 words>", "notes": "<the facts to keep straight: goals, secrets, relationships, physical details, ≤40 words>"}.',
    "2-8 entries, most important first. Only characters who actually appear in the text. EXCLUDE anyone already on the sheet (listed below). If there is no one to add, respond with [].",
  ].join("\n");

  const user = [
    `Working title: "${title}"`,
    existing ? `Already on the sheet (do not repeat):\n${existing}` : "",
    continuity ? `Continuity record:\n${continuity}` : "",
    voices ? `Voice notes so far:\n${voices}` : "",
    "The manuscript:",
    "----------",
    fullText,
    "----------",
    "",
    "Return the JSON array now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const reply = await complete(
    tuned({ model: ANALYSIS_MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: user }] }, 0.2)
  );
  return parseJsonArray(reply)
    .filter((c) => c && typeof c.name === "string" && c.name.trim())
    .slice(0, 8)
    .map((c) => ({
      name: c.name.trim().slice(0, 80),
      role: typeof c.role === "string" ? c.role.trim().slice(0, 160) : "",
      voice: typeof c.voice === "string" ? c.voice.trim().slice(0, 200) : "",
      notes: typeof c.notes === "string" ? c.notes.trim().slice(0, 400) : "",
    }));
}

/**
 * Guide mode, blank book: propose the opening idea — the direction the
 * director would type to start the story — squarely in the chosen author
 * style's home territory, within the book's audience/maturity settings.
 * Returns one plain-text direction.
 */
export async function suggestOpening({ title, guide }) {
  const g = guide || {};
  const system = [
    "You help the director of a brand-new novel find their opening idea. The director gives short directions; an AI author writes the prose. The book is still blank.",
    "",
    `The book's chosen prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
    `Audience settings for the book (the premise must fit within them): ${maturityText(g)}`,
    "",
    "Propose ONE opening idea: 2-4 sentences describing how the story could open — the character, the place, the moment, and the tension underneath it. Make the premise unmistakably that style's home territory (its subjects, settings, and preoccupations), and make it specific — a particular person in a particular place, not a formula.",
    'Phrase it as a direction to the author (e.g. "Open with …"), not as finished prose.',
    "Output the direction ONLY — plain text, a single idea, no preamble, no options, no markdown.",
  ].join("\n");
  const t = (title || "").trim();
  const user =
    t && t.toLowerCase() !== "untitled"
      ? `The working title is "${t}" — let the idea suit it. Propose the opening direction now.`
      : "Propose the opening direction now.";
  const reply = await complete(
    tuned({ model: MODEL, max_tokens: 400, system, messages: [{ role: "user", content: user }] }, 1)
  );
  return reply.trim().slice(0, 1200);
}

/**
 * Honest revision pass: rewrite the WHOLE manuscript to address the editor's
 * critique and genuinely raise the story's quality (target 90+), preserving the
 * core story, voice, and chapter structure. Streams the rewritten manuscript
 * (with `## Chapter` markers). The result is re-scored normally — nothing here
 * touches or fakes the score; it only improves the substance.
 */
export async function reviseManuscript({ title, author, guide, mode, fullText, critique, quality, score, lens, onDelta }) {
  const g = guide || {};
  const adultRules = adultWriterRules(g);
  const voice =
    mode === "guide"
      ? [
          `- Prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
          `- Narrate in ${POV_TEXT[g.pov] || POV_TEXT.third_limited}, ${TENSE_TEXT[g.tense] || TENSE_TEXT.past}.`,
          `- ${maturityText(g)}`,
          adultRules ? `- ${adultRules}` : "",
        ].filter(Boolean).join("\n")
      : "- Preserve the established voice, point of view, tense, and tone of the manuscript.";

  const system = [
    "You are a master editor performing a full revision pass on a COMPLETED manuscript.",
    "The author wants the STORY raised to at least 90/100 by GENUINELY fixing its weaknesses — never by padding, inflating, flattering, or gaming a score. Improve substance, not length.",
    "",
    "Your task:",
    "- Rewrite the ENTIRE manuscript from start to finish. Keep it recognizably the same book — its central characters and the spirit of its premise — but you have broad license to take BOLD liberties with the PLOT and STRUCTURE wherever that raises the impact: reorder or rebuild scenes, change what happens, add or cut beats and subplots, reframe the conflict, and reshape the arc and ending. Favor a stronger story over fidelity to the original sequence of events.",
    "- Directly address every weakness in the editor's critique below: deepen characters and motivation, sharpen and raise the stakes, fix pacing, resolve loose threads, cut slack, and land a satisfying, earned ending.",
    "- Restructure scenes, add or remove material, merge or split passages, invent new connective plot, and rework any line — whatever genuinely serves the story. Be willing to change WHAT HAPPENS, not just how it is worded.",
    "- CUT what has not earned its place: delete, or compress to a line, any scene in which nothing changes; strip description that repeats what is established or that nobody in the scene would notice; remove recap and reflection that restates what was just dramatized. Connective stretches should come out SHORTER than the original.",
    "- EXPAND what matters: every turning point the draft summarized, skipped past, cut away from, or settled in a few lines — a decision, confrontation, revelation, reversal, payoff — gets a full scene played out moment by moment.",
    "- CLOSE every plot hole: knowledge a character had no way to get, a motive that flips without cause, a problem solved by coincidence or a convenient arrival, an impossible timeline, a consequence that should have followed and did not, a thread simply dropped. And carry every change you make through the rest of the book — no reference left to something you cut, no missing consequence for something you added.",
    "- Keep the chapter structure flexible: emit a line `## Chapter` (or `## Chapter: Title`) at the start of each chapter, then its prose. You may re-divide chapters where the new structure calls for it.",
    voice,
    `- ${NATURAL_PROSE}`,
    `- ${economyRule(g)}`,
    "- Output ONLY the rewritten manuscript — `## Chapter` marker lines and prose. No preamble, commentary, notes, score, or other markdown.",
  ].join("\n");

  const user = [
    `Working title: "${title}"  ·  Author: ${author}`,
    "",
    quality ? `The editor's current assessment: ${quality}` : "",
    typeof score === "number"
      ? `Current score: ${score}/100 — raise it to at least 90 by fixing the issues below.`
      : "Raise the story to at least 90/100 by fixing the issues below.",
    "",
    "Weaknesses to fix (the editor's critique):",
    critique || "(Strengthen characters, stakes, pacing, structure, and the ending.)",
    "",
    "The complete manuscript to revise:",
    "----------",
    fullText,
    "----------",
    lens || "",
    "",
    "Now write the full revised manuscript, with `## Chapter` markers, addressing every weakness above. Output the manuscript only.",
  ]
    .filter(Boolean)
    .join("\n");

  const text = await runText(
    tuned(
      {
        model: MODEL,
        max_tokens: 32000, // a whole-book rewrite; streamed
        system,
        messages: [{ role: "user", content: user }],
      },
      0.9
    ),
    onDelta
  );
  if (!text) throw new Error("The revision came back empty.");
  return text;
}

// A concise, concrete plan for raising the story to 90+, shared across all chunk
// rewrites so a long book is revised coherently. Non-streaming.
export async function revisionPlan({ title, fullText, critique, quality, score, lens, sceneInstruction }) {
  const system = [
    "You are a ruthless, brilliant developmental editor. Read the complete manuscript and the editor's critique, then produce a REVISION PLAN to raise the STORY to at least 90/100.",
    "First diagnose what is actually CAPPING the score — the story-level and structural limits: weak, abstract, or low stakes; thin, passive, or static characters; slack or shapeless structure; a predictable, convenient, or unearned arc; a flat or rushed ending; missing consequences and tension. This is NOT about prose — polished sentences alone will never move the score.",
    "Then prescribe BOLD, specific, high-impact fixes grounded in THIS story: sharpen and concretize the stakes, give the protagonist a real arc with genuine cost and change, restructure and cut dead weight, add complication and reversal, plant and pay off, and build to a powerful, earned ending. Take real liberties with the PLOT and STRUCTURE for impact — reorder events, change outcomes, add or remove scenes and subplots, and reshape the arc. Keep the central characters and the spirit of the premise, but do not be precious about the original sequence of events; change WHAT HAPPENS, not just how it is worded.",
    "Three faults get their own diagnosis, because they are the ones a rewrite most often leaves in place: (1) PLOT HOLES — a character acting on knowledge they had no way to get, a motive that flips without cause, a problem solved by coincidence or a convenient arrival, an impossible timeline, a consequence that should have followed and did not, a dropped thread; (2) SLACK — scenes in which nothing changes, and stretches of description, travel, or reflection that could go in a line; (3) RUSHED TURNS — decisions, confrontations, revelations, and payoffs that the draft summarized, skipped, or settled in a few lines when they needed a full scene.",
    "Output a tight numbered list (6-12 items), each a concrete change. No preamble, no praise.",
    "After the numbered list, add these three short labelled blocks, one item per line:",
    "CUT / EXPAND: the specific scenes to cut or compress to a line, and the specific turning points to expand into full scenes.",
    "LOGIC FIXES: each plot hole in the manuscript and its specific fix — and, for every plot change in your list, what later material must change to stay consistent with it.",
    "CANON AFTER REVISION: the facts as they stand once your changes are made — the order of events, who knows what and when, who is alive, where things are. The book is rewritten in separate parts that cannot see one another, so this block is what keeps them consistent: make it complete enough that no part can contradict another.",
    sceneInstruction ? `After the numbered list, ${sceneInstruction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const user = [
    `Title: "${title}"`,
    quality ? `Current assessment: ${quality}` : "",
    typeof score === "number" ? `Current score: ${score}/100.` : "",
    critique ? `Critique to address:\n${critique}` : "",
    lens || "",
    "",
    "Manuscript:",
    "----------",
    fullText,
    "----------",
    "",
    "Write the revision plan now.",
  ]
    .filter(Boolean)
    .join("\n");
  // Adaptive thinking (where the model supports it) for the story-level
  // diagnosis; the raised max_tokens leaves room for the thinking itself.
  const text = await runText(
    withThinking(
      tuned({ model: REVISE_MODEL, max_tokens: 12000, system, messages: [{ role: "user", content: user }] }, 0.5),
      "high"
    )
  );
  return (text || "").trim();
}

// Rewrite ONE consecutive part of a longer manuscript, following the shared plan
// and continuing seamlessly from the already-rewritten text. Streams its part.
export async function reviseChunk({
  title,
  author,
  guide,
  mode,
  plan,
  synopsis,
  score,
  priorTail,
  chunkText,
  isFirst,
  isLast,
  lens,
  onDelta,
}) {
  const g = guide || {};
  const adultRules = adultWriterRules(g);
  const voice =
    mode === "guide"
      ? [
          `- Prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
          `- Narrate in ${POV_TEXT[g.pov] || POV_TEXT.third_limited}, ${TENSE_TEXT[g.tense] || TENSE_TEXT.past}.`,
          `- ${maturityText(g)}`,
          adultRules ? `- ${adultRules}` : "",
        ].filter(Boolean).join("\n")
      : "- Preserve the established voice, point of view, tense, and tone of the manuscript.";

  const system = [
    "You are a ruthless, brilliant developmental editor rewriting a COMPLETED manuscript in consecutive passes to raise it to at least 90/100.",
    typeof score === "number"
      ? `The current draft scores ${score}/100. Cosmetic paraphrasing will NOT move that — you must materially strengthen the STORY: raise stakes, give scenes real consequence, deepen character through choice and action, add complication and reversal.`
      : "Materially strengthen the STORY — not just the wording: raise stakes, add consequence, deepen character, add complication and reversal.",
    "Keep it recognizably the SAME story (same central characters and the spirit of the premise), but take BOLD liberties with the plot and structure for impact: change events, scenes, order, outcomes, and structure wherever the plan or the story calls for it. Be bold — transform weak material and invent stronger plot rather than rephrasing what's there.",
    "You are rewriting ONE consecutive part of the book. Follow the shared revision plan and stay continuous with the part already rewritten and with the overall story.",
    isFirst
      ? "- This is the FIRST part — open the book with a strong, propulsive hook."
      : "- Continue SEAMLESSLY from the end of the already-rewritten text shown below. Do NOT recap, summarize, or repeat any of it.",
    "- Implement the plan where it applies to this part; make every beat earn its place.",
    "- The plan's CANON AFTER REVISION block is binding: other parts of the book are being rewritten to match it and cannot see your text, so never contradict it, and never invent a change to events, knowledge, or outcomes that later parts would need to know about and are not told. Apply the plan's LOGIC FIXES that fall in this part; leave no reference to anything the plan cuts.",
    "- Follow the plan's CUT / EXPAND list: scenes in which nothing changes are deleted or compressed to a line, description is stripped back to what earns its place, and each turning point in this part is played out as a full scene, moment by moment. This part may come out shorter or longer than its source — length follows importance.",
    "- Preserve `## Chapter` markers: emit a `## Chapter` (or `## Chapter: Title`) line exactly where a chapter begins in the source part.",
    isLast ? "- This is the FINAL part — deliver a powerful, earned, fully resolved ending." : "",
    voice,
    `- ${NATURAL_PROSE}`,
    `- ${economyRule(g)}`,
    `- ${LOGIC}`,
    "- Output ONLY the rewritten prose for THIS part (with any `## Chapter` marker lines). No preamble, commentary, plan, or other markdown.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Title: "${title}"  ·  Author: ${author}`,
    "",
    `Shared revision plan (apply the parts relevant to this section):\n${plan || "(strengthen stakes, character arcs, structure, and the ending)"}`,
    synopsis ? `\nThe story in brief: ${synopsis}` : "",
    priorTail
      ? `\nEnd of the text already rewritten (continue directly from here — do NOT repeat it):\n----------\n${priorTail}\n----------`
      : "",
    `\nThe SOURCE part to rewrite now (transform it; do not merely paraphrase):\n----------\n${chunkText}\n----------`,
    lens ? `\n${lens}` : "",
    "\nWrite the rewritten version of this part only.",
  ]
    .filter(Boolean)
    .join("\n");

  const text = await runText(
    tuned(
      { model: REVISE_MODEL, max_tokens: 12000, system, messages: [{ role: "user", content: user }] },
      0.9
    ),
    onDelta
  );
  if (!text) throw new Error("A revision part came back empty.");
  return text;
}

/**
 * Read the manuscript and return a structured assessment. Returns null on
 * parse failure so a flaky analysis never blocks the writing flow.
 */
// Trim text to a maximum length WITHOUT cutting mid-sentence. Prefers to end at
// the last sentence terminator; otherwise ends at a whole word with an ellipsis.
function clipSentence(text, max) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  let stop = -1;
  for (const ch of [".", "!", "?"]) stop = Math.max(stop, cut.lastIndexOf(ch));
  if (stop >= max * 0.5) return cut.slice(0, stop + 1).trim();
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trim() + "…";
}

export async function analyzeStory({ title, fullText, prior, guide, eroticaLean, adult, arc, sections, final, digest, coldRead, chapterNum, rubric, brief, outline, audit, dismissed }) {
  const showArc = !final && Array.isArray(arc) && arc.filter((h) => h && h.text).length > 0;
  const hasArc = showArc;
  // Adult-audience review lines come from the content pack, if one is installed
  // (see maturity.js); with none, `ar` is empty apart from the baseline lean.
  const ar = adultReview({ adult, eroticaLean, final, sections });
  const arcHeadings = hasArc
    ? arc
        .filter((h) => h && h.text)
        .map((h, i) => {
          const hz = ARC_HORIZON[h.pace] || ARC_HORIZON.gradually;
          const elapsed = Number.isFinite(h.bornTurns) ? Math.max(0, (sections || 0) - h.bornTurns) : 0;
          return `${i + 1}. ${h.text}  [pace: ${h.pace || "gradually"}; horizon ${hz.label}; set ~${elapsed} section(s) ago]`;
        })
        .join("\n")
    : "";
  const arcProgressLine =
    '  "arcProgress": Assess progress toward the author\'s heading goals listed below. Output EXACTLY one line per goal, IN THE SAME ORDER, newline-separated, with NO numbering or bullets. Each line: a brief, honest note on how far the story has actually moved toward that goal, AND whether it is on pace, ahead, or behind given its horizon and how long ago it was set (e.g. "Untouched — and now behind pace.", "Being set up, on track.", "Essentially achieved."). Judge only what the manuscript shows.';
  const arcDoneLine =
    '  "arcDone": List the 1-based numbers of any heading goals below that are now SUBSTANTIALLY ACHIEVED — clearly and concretely realized in the story text, their core payoff delivered — not merely introduced, set up, or approaching. Comma-separated (e.g. "1, 3"), or "none". Be conservative: when in doubt, leave it out.';
  const qualityLine = final
    ? guide
      ? '  "quality":   1-2 sentences assessing the FINISHED STORY as a complete work — how well its momentum, characters, structure, stakes, and arcs resolve, knowing nothing more will be added. Do NOT comment on prose or writing craft.'
      : '  "quality":   1-2 sentences of candid assessment of the finished work as a whole.'
    : guide
    ? '  "quality":   1-2 sentences assessing the STORY ITSELF — momentum, characters, structure, stakes, and the strength of the director\'s choices. Do NOT comment on prose style or writing craft (an AI wrote the prose; never praise or critique the writing itself).'
    : '  "quality":   1-2 sentences of candid, constructive assessment of the craft.';
  const scoreLine = final
    ? guide
      ? '  "qualityScore": an integer 1-100 for the FINISHED STORY as a complete work (not prose).'
      : '  "qualityScore": an integer 1-100 for the finished work overall.'
    : guide
    ? '  "qualityScore": an integer 1-100 reflecting the strength of the STORY and the direction (not the prose quality).'
    : '  "qualityScore": an integer 1-100 reflecting current craft quality.';
  const critiqueLine = final
    ? guide
      ? `  "critique":  A thorough, candid critique of the FINISHED STORY as a whole (not the prose), knowing it is complete and nothing more will be added. 3-4 substantial points, each 2-3 sentences, newline-separated (no bullet characters). Name each weakness precisely, ground it in the text, and explain how it limits the completed work — unresolved threads, an underdeveloped or unearned arc, a rushed ending, pacing across the whole, etc. Do NOT critique prose or writing craft, and do NOT propose future additions.${ar.critique}`
      : '  "critique":  A thorough, candid critique of the finished work as a whole, knowing it is complete. 3-4 substantial points, each 2-3 sentences, newline-separated (no bullet characters). Name each weakness precisely, ground it in the text, and explain how it limits the completed work. Do NOT propose future additions.'
    : guide
    ? `  "critique":  A thorough, candid critique of the STORY (not the prose). Write 3-4 substantial points, each 2-3 sentences, newline-separated (no bullet characters). For each: name the weakness precisely, ground it in a specific moment, character, or pattern actually in the text, and explain why it weakens the story or holds back the score (e.g. thin or abstract stakes, an underdeveloped character or motivation, a plot hole or an event with no cause, a turning point that was rushed or happened offstage, a scene that changes nothing, a predictable turn, tonal inconsistency, an unearned development). Be specific, perceptive, and constructive — this is the most valuable part of the notes, so spend real care on it. Do NOT critique the prose or writing craft.${ar.critique}`
    : '  "critique":  A thorough, candid critique. Write 3-4 substantial points, each 2-3 sentences, newline-separated (no bullet characters). For each: name the weakness precisely, ground it in a specific moment or pattern in the text, and explain why it holds the work back. Be specific, perceptive, and constructive — this is the most valuable part of the notes, so spend real care on it.';
  const suggestionsLine = guide
    ? ar.suggestionsLine ||
      `  "suggestions": 2-3 concrete ideas for the NEXT section that would directly address the weaknesses raised in the critique. Put EACH suggestion on its own line, separated by newlines — never as one continuous paragraph (no bullet characters). Phrase each as a usable direction (what could happen next), make the three genuinely different from one another, and have each clearly tackle a specific critique point.`
    : '  "suggestions": 2-3 concrete ideas for what to write NEXT that would directly address the weaknesses raised in the critique. Put EACH suggestion on its own line, separated by newlines — never as one continuous paragraph (no bullet characters). Phrase each as a usable prompt, make them genuinely different, and have each clearly tackle a specific critique point.';
  const pacingLine =
    '  "pacing": ONE line judging the STORY\'s current PLOT pacing from the text shown — how fast the plot moves and how much room the scenes are given. Start with exactly one of the labels TOO FAST, TOO SLOW, or STEADY, then a short reason (under ~15 words) grounded in a specific moment or pattern (e.g. "events pile up and scenes get no room to breathe" or "lingers on one conversation and the plot stalls"). Judge plot momentum and scene depth, not prose rhythm or sentence length.';
  const system = [
    "You are a perceptive editor maintaining notes on a manuscript-in-progress.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences, no preamble.",
    `Use exactly these keys, IN THIS ORDER (all strings except qualityScore): style, genre, synopsis, quality, qualityScore, critique, pacing, ${
      final ? "" : "nextDirection, suggestions, "
    }${hasArc ? "arcProgress, arcDone, " : ""}${final ? "" : "holes, balance, motifs, voices, ledger, "}continuity${ar.key ? `, ${ar.key}` : ""}.`,
    guide
      ? '  "style":     1-2 sentences neutrally describing the prose voice and narration (descriptive only).'
      : '  "style":     1-2 sentences describing the writing style and narrative voice.',
    '  "genre":     a short genre label (e.g. "Literary horror", "Cozy mystery").',
    final
      ? '  "synopsis":  A polished back-cover synopsis of the COMPLETED novel — the evocative blurb you would print on the back of the book to entice a reader. 2-4 sentences, present tense, conveying premise, character, and stakes WITHOUT spoiling the ending.'
      : '  "synopsis":  2-4 sentences summarizing the story so far.',
    qualityLine,
    scoreLine,
    critiqueLine,
    pacingLine,
    final
      ? ""
      : `  "nextDirection": ONE complete sentence (at most ~35 words) the author could use as the instruction for the next section — phrased as a direction (what should happen next), not a summary. It must be a finished sentence ending in punctuation. Build naturally on where the story just left off.${ar.direct}`,
    final ? "" : suggestionsLine,
    hasArc ? arcProgressLine : "",
    hasArc ? arcDoneLine : "",
    final
      ? ""
      : '  "holes": The OPEN LOGIC GAPS in the story so far — plot holes a careful reader would catch: a character acting on knowledge they had no way to get; a motivation that flips without cause; a problem solved by coincidence, sudden competence, or an unexplained arrival; an impossible timeline or travel time; an object, injury, or constraint that silently vanished; a consequence that should have followed and did not; a thread simply dropped. One per line, newline-separated, no bullets, each naming the specific moment and what is missing (under ~25 words). Carry every prior line forward until the text actually repairs it, then drop it. At most 6 lines. If there are none, write "none". Report only real gaps — NOT mysteries the story is deliberately withholding (those belong in the ledger), and not matters of taste.',
    final
      ? ""
      : '  "balance": How the most recent sections SPENT their words. 1-3 short lines, newline-separated, no bullets, each starting with SLACK (a scene, a description, a journey, or a stretch of reflection that ran long without changing anything — name it) or RUSHED (a turning point — a decision, confrontation, revelation, or payoff — that was summarized, skipped, or given a few lines when it needed a full scene — name it). If the proportions are right, write "balanced". This is fed to the writer, so be specific about which passage.',
    final
      ? ""
      : '  "motifs": The most distinctive images, metaphors, sensory details, pet phrases, AND sentence constructions the manuscript has ALREADY leaned on — especially anything used more than once, weighting the most recent sections heavily. Constructions count: a repeated "not X, but Y" contrast, a signature rhythm, a recurring way of ending scenes. 4-8 short fragments (each under ~10 words), newline-separated, no bullets or numbering. These are shown to the writer as a do-not-reuse list, so include only genuinely distinctive wording or patterns (never ordinary words or common actions).',
    final
      ? ""
      : '  "voices": For the 2-4 characters most present in the recent material: one compact line each in the form "Name: how they talk" — diction, rhythm, verbal habits, what they avoid saying. Newline-separated. These keep dialogue voices distinct, so make them specific and contrastive with one another; carry forward and refine prior entries for characters not in the excerpt.',
    final
      ? ""
      : `  "ledger": The SETUPS-AND-PAYOFFS ledger — a running list of planted details, promises to the reader, and unresolved questions (Chekhov's guns: a hidden letter, a character's secret, a threat made, a question the reader was made to ask). One per line, newline-separated, no bullets, in this exact form: "ch N · the setup · status", where N is the chapter it was planted in and status is "open", "open — stale" (planted 5+ chapters ago and untouched since), or "paid off ch M". Carry every prior line forward and UPDATE its status from the new material; add newly planted setups; drop a line only once it has been paid off for 3+ chapters. Only genuine setups the reader would remember — not every detail. At most 10 lines. The writing is currently in chapter ${chapterNum || "?"}.`,
    `  "continuity": a COMPACT running record for consistency — cast (names + a few words each), key places, key facts, open threads. Newline-separated short lines. Keep it under ~900 characters; prune the least important details to stay within that.${ar.field ? "" : " This key comes LAST."}${ar.field}`,
    "",
    final
      ? "You are given the COMPLETE, FINISHED manuscript below — the author has marked the book as ended and nothing more will be added. Evaluate it as a finished whole."
      : "IMPORTANT: You may be shown a prior continuity record plus an excerpt of the manuscript (the opening and the most recent material; the middle may be omitted). Treat the prior record as authoritative for things you cannot currently see: carry every still-valid character and fact forward, and ADD or UPDATE based on the new material. Never drop an established character just because they don't appear in the excerpt.",
    digest
      ? "You are also given a chapter-by-chapter digest of the closed chapters. It is authoritative for the parts of the manuscript not shown; use it to judge structure, pacing across the whole, and whether setups have been paid off."
      : "",
    coldRead
      ? "You are also given a COLD READ of the most recently completed chapter: notes from a reader who was handed that chapter alone, with no memory of the rest of the book. Weigh it as evidence of how the writing lands on a fresh reader (confusion there is real even if earlier chapters explain it; skimming there is real). Let it inform the critique and suggestions where it points at something the story can fix."
      : "",
    brief
      ? final
        ? "You are also given the AUTHOR'S BRIEF — what this book set out to be. Judge the finished work against it: say in the critique where it kept its promise and where it fell short of its own aims."
        : "You are also given the AUTHOR'S BRIEF — what this book is trying to be. Hold the story against it: where the manuscript is drifting from its premise, promise, or intended ending, say so in the critique, and aim nextDirection and the suggestions at the book the brief describes."
      : "",
    outline && !final
      ? "You are also given the ROLLING OUTLINE for the chapter being written and those after it. Let nextDirection and the suggestions move the story toward what the outline plans for THIS chapter — unless the manuscript has clearly outgrown the outline, in which case follow the manuscript."
      : "",
    audit
      ? "You are also given the AUDIT of the most recently closed chapter — a deeper read than yours, made on the full chapter text. Treat its findings as established: build on them rather than re-deriving them."
      : "",
    dismissed && !final
      ? "Some suspected logic gaps were examined in that audit and DISMISSED as not real gaps. They are listed below; do not report them under holes again."
      : "",
    ar.lean,
    rubric
      ? `${rubric}\nUse this lens as one input to the score, critique, and suggestions — the readers' expectations alongside your own judgment of craft; it is guidance about how the book will land, not a checklist.`
      : "",
    "Keep every field concise so the whole object stays small. Be specific and honest.",
  ]
    .filter(Boolean)
    .join("\n");

  const priorContinuity = prior && prior.continuity ? String(prior.continuity).slice(0, 1600) : "";
  const priorLedger = prior && prior.ledger ? String(prior.ledger).slice(0, 1400) : "";
  const priorBlock = prior
    ? [
        "Prior continuity record (carry forward; update, do not discard):",
        priorContinuity || "(none yet)",
        prior.synopsis ? `Prior synopsis: ${prior.synopsis}` : "",
        !final && priorLedger ? `Prior setups-and-payoffs ledger (carry forward; update statuses):\n${priorLedger}` : "",
        !final && prior.holes
          ? `Prior open logic gaps (carry each forward until the text repairs it):\n${String(prior.holes).slice(0, 1100)}`
          : "",
        "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const coldBlock =
    coldRead && (coldRead.confused || coldRead.skimmed || coldRead.wanted)
      ? [
          `Cold read of chapter ${coldRead.num}${coldRead.title ? ` (“${coldRead.title}”)` : ""} by a reader given ONLY that chapter:`,
          coldRead.confused ? `Confused: ${coldRead.confused}` : "",
          coldRead.skimmed ? `Skimmed: ${coldRead.skimmed}` : "",
          coldRead.wanted ? `Wanted: ${coldRead.wanted}` : "",
          coldRead.grip != null ? `Grip: ${coldRead.grip}/10` : "",
          "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const user = [
    `Working title: "${title}"`,
    "",
    priorBlock,
    brief ? `${brief}\n` : "",
    outline && !final ? `${outline}\n` : "",
    digest ? `Chapter-by-chapter digest of the closed chapters:\n${digest}\n` : "",
    audit ? `${audit}\n` : "",
    dismissed && !final ? `Dismissed in the audit — not real gaps, do not re-flag:\n${dismissed}\n` : "",
    coldBlock,
    final
      ? "The complete, finished manuscript:"
      : "Manuscript (opening and most recent material; middle may be omitted on long books):",
    "----------",
    fullText,
    "----------",
    "",
    hasArc ? `The author's heading goals (assess arcProgress toward each, in this order):\n${arcHeadings}\n` : "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n");

  // Adaptive thinking (where supported) for the story-level diagnosis. The
  // max_tokens headroom covers the thinking plus the growing notes object.
  const reply = await complete(
    withThinking(
      tuned(
        {
          model: ANALYSIS_MODEL,
          max_tokens: 12000,
          system,
          messages: [{ role: "user", content: user }],
        },
        0.3
      ),
      "medium"
    )
  );

  let raw = reply;
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Strict parse first; fall back to per-field extraction so a truncated
  // continuity (the last, largest field) never wipes out the other notes.
  let obj = null;
  try {
    const f = raw.indexOf("{");
    const l = raw.lastIndexOf("}");
    obj = JSON.parse(f !== -1 && l > f ? raw.slice(f, l + 1) : raw);
  } catch {
    obj = null;
  }
  const getStr = (k) => {
    if (obj && typeof obj[k] === "string") return obj[k];
    const m = raw.match(new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    if (m) {
      try {
        return JSON.parse('"' + m[1] + '"');
      } catch {
        return m[1];
      }
    }
    return "";
  };
  const getNum = (k) => {
    if (obj && Number.isFinite(Number(obj[k]))) return Number(obj[k]);
    const m = raw.match(new RegExp('"' + k + '"\\s*:\\s*(\\d+)'));
    return m ? Number(m[1]) : NaN;
  };

  const style = getStr("style").trim();
  const genre = getStr("genre").trim();
  const synopsis = getStr("synopsis").trim();
  const quality = getStr("quality").trim();
  const critique = getStr("critique").trim();
  const pacing = getStr("pacing").trim().slice(0, 200);
  const suggestions = final ? "" : splitSuggestionBlob(getStr("suggestions"));
  const extra = ar.key ? getStr(ar.key).trim() : "";
  const motifs = final ? "" : getStr("motifs").trim().slice(0, 700);
  const voices = final ? "" : getStr("voices").trim().slice(0, 600);
  const ledger = final ? "" : getStr("ledger").trim().slice(0, 1400);
  // "none" / "balanced" are real answers (the gaps were repaired), not a missing
  // field — they must clear the prior note rather than fall back to it.
  const cleared = (v) => /^(none|balanced|n\/a)\.?$/i.test(v);
  const noteField = (k, max) => {
    if (final) return "";
    const v = getStr(k).trim().slice(0, max);
    if (!v) return (prior && prior[k]) || "";
    return cleared(v) ? "" : v;
  };
  const holes = noteField("holes", 1100);
  const balance = noteField("balance", 500);
  const arcProgress = getStr("arcProgress").trim();
  const arcDone = hasArc ? getStr("arcDone").trim() : "";
  let nextDirection = final ? "" : clipSentence(getStr("nextDirection").trim(), 360);
  let continuity = getStr("continuity").trim();
  if (!continuity) continuity = priorContinuity;
  if (continuity.length > 1600) continuity = continuity.slice(0, 1600).trim();
  let score = getNum("qualityScore");
  score = Number.isFinite(score) ? Math.min(100, Math.max(1, Math.round(score))) : null;

  // If we recovered nothing usable, keep the previous analysis (return null).
  if (!style && !genre && !synopsis && !quality && !critique && !suggestions && score == null && !continuity && !nextDirection) {
    return null;
  }

  return {
    style: style || (prior && prior.style) || "",
    genre: genre || (prior && prior.genre) || "",
    synopsis: synopsis || (prior && prior.synopsis) || "",
    quality: quality || (prior && prior.quality) || "",
    qualityScore: score != null ? score : prior ? prior.qualityScore : null,
    critique: critique || (prior && prior.critique) || "",
    pacing: pacing || (prior && prior.pacing) || "",
    nextDirection: nextDirection || (prior && prior.nextDirection) || "",
    suggestions: final ? "" : suggestions || (prior && prior.suggestions) || "",
    ...(ar.key ? { [ar.key]: extra || (prior && prior[ar.key]) || "" } : {}),
    motifs: final ? "" : motifs || (prior && prior.motifs) || "",
    voices: final ? "" : voices || (prior && prior.voices) || "",
    ledger: final ? (prior && prior.ledger) || "" : ledger || (prior && prior.ledger) || "",
    holes,
    balance,
    arcProgress: arcProgress || (hasArc && prior && prior.arcProgress) || "",
    arcDone,
    continuity,
    final: Boolean(final),
    updatedAt: Date.now(),
  };
}
