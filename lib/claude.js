import Anthropic from "@anthropic-ai/sdk";
import { ARC_HORIZON } from "@/lib/book";

// Prose and analysis can run on different models. Defaults keep both on Sonnet
// 4.6; set CLAUDE_MODEL (prose) and/or CLAUDE_ANALYSIS_MODEL to upgrade either —
// e.g. CLAUDE_MODEL=claude-opus-4-8 for richer prose while analysis stays cheap.
// Per our chosen split: prose generation on Opus 4.8, analysis on Sonnet 4.6.
// Each is overridable by env var; the revision pass follows the prose model.
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";
const ANALYSIS_MODEL = process.env.CLAUDE_ANALYSIS_MODEL || "claude-sonnet-4-6";
const REVISE_MODEL = process.env.CLAUDE_REVISE_MODEL || MODEL;

// Opus 4.7+, Fable, and Mythos reject a custom temperature/top_p/top_k (HTTP 400).
// Only attach a temperature for models that accept one, so a model swap can't 400.
function rejectsSampling(model) {
  return /claude-(opus-4-[789]|opus-[5-9]|fable|mythos)/.test(model || "");
}
function tuned(params, temperature) {
  return rejectsSampling(params.model) ? params : { ...params, temperature };
}

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY is not set on the server.");
    err.code = "NO_API_KEY";
    throw err;
  }
  return new Anthropic({ apiKey });
}

function joinText(blocks) {
  return (blocks || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// Run a completion. If `onDelta` is provided, stream the model's text and call
// it with each chunk as it arrives; otherwise do a single blocking call. Either
// way the full text is returned.
async function runText(params, onDelta) {
  if (typeof onDelta !== "function") {
    const res = await client().messages.create(params);
    return joinText(res.content);
  }
  const stream = client().messages.stream(params);
  let text = "";
  stream.on("text", (delta) => {
    text += delta;
    try {
      onDelta(delta);
    } catch {}
  });
  const final = await stream.finalMessage();
  return joinText(final.content) || text.trim();
}

// Steer every writing mode away from the tells of "AI prose." Injected into each
// system prompt that actually generates narrative (both write modes and the
// revision passes) so the guidance is consistent everywhere.
const NATURAL_PROSE =
  "Write like a human novelist, not an AI. Not every sentence wants to be profound, and not every observation needs an elegant metaphor — let plain, declarative sentences carry their share, and let some moments stay ordinary: some paragraphs should be purely functional, some things deserve one detail rather than three, and not everything a character notices has to mean something. Vary sentence rhythm for real — mix four-word sentences among forty-word ones; uniform sentence lengths are a machine tell. Avoid the trademark AI constructions: the \"not X, but Y\" contrast (\"It wasn't anger. It was something older.\"), rule-of-three lists (\"the salt, the smoke, the distant bells\"), the dramatic one-line paragraph as a scene button, anaphora runs (\"She remembered the boat. She remembered the rope.\"), and the \"the way a thing does X when Y\" simile. Avoid the stock body-language kit: breaths characters didn't know they were holding, smiles not reaching eyes, whitening knuckles, \"something shifted\", beats passing, silences stretching. Resist ending scenes or paragraphs on a tidy aphorism or reflexive thematic summing-up. Trust concrete detail, action, and dialogue over decoration — and make at least one choice a competent-but-safe writer wouldn't: a word, a beat, a place to cut.";

// Dialogue-specific guidance: models default to dialogue that is too articulate
// and too cooperative. Injected alongside NATURAL_PROSE wherever prose with
// dialogue is generated (not in the polish pass, which shouldn't invent lines).
const NATURAL_DIALOGUE =
  "Write dialogue the way people actually talk: let characters interrupt, deflect, trail off, answer the wrong question, or say something briefly banal. Not every line should be articulate or advance the plot, and people rarely say exactly what they mean. Keep each character's voice distinct — diction, rhythm, verbal habits, what they won't say — rather than giving everyone the same fluent register.";

const STYLE_PROMPT = {
  literary:
    "Literary fiction — lyrical, image-rich, psychologically interior; let subtext and rhythm carry meaning.",
  cinematic:
    "Cinematic — vivid, propulsive, scene-driven prose with strong visual blocking and momentum.",
  hemingway:
    "Hemingway — terse and declarative; short, plain sentences and concrete nouns; minimal adjectives and adverbs; emotion conveyed through action and dialogue, not description (the iceberg theory).",
  murakami:
    "Murakami-esque contemporary magical realism — a calm, detached, understated voice in plain yet hypnotic prose, into which the uncanny quietly intrudes. Set ordinary modern life (solitary routines, cooking, jazz and classical records, bars, cats, late-night phone calls) beside dreamlike, unexplained phenomena: parallel worlds, prophetic dreams, doppelgängers, talking animals, wells and hidden doorways, the sense that reality has a hidden seam. Favor melancholic, alienated protagonists and enigmatic women who appear and vanish; leave symbols and questions deliberately unresolved. Include a frank, dreamlike sensuality and mature sexual undercurrent WHERE THE BOOK'S MATURITY SETTINGS ALLOW (defer to them). Keep the tone matter-of-fact even as events turn surreal.",
  adventure: "Pulp adventure — fast, energetic, plot-driving; clear action and steadily rising stakes.",
  burdett:
    "Burdett / 'Bangkok 8' crime noir — gritty, atmospheric contemporary realism in a wry, philosophical first-person voice: a devout-Buddhist's-eye view of a corrupt modern world. Drench the reader in sense of place — heat, traffic, street food, markets, temples, neon, the river. Let Buddhist ideas of karma, fate, and reincarnation sit as the narrator's sincere worldview (a philosophical lens, not literal magic) beside police corruption, organized crime, the drug and sex trades, and the collision of Eastern spirituality with Western appetite. Dark humor, sharp cross-cultural social observation, morally grey characters, and an unflinching, matter-of-fact treatment of vice and violence WHERE THE BOOK'S MATURITY SETTINGS ALLOW (defer to them). Keep it grounded and realistic — no supernatural events.",
  minimalist: "Minimalist — spare, restrained, concrete; short sentences, white space, understatement.",
};
const POV_TEXT = {
  first: "first person",
  third_limited: "third person limited",
  third_omniscient: "third person omniscient",
};
const TENSE_TEXT = { past: "past tense", present: "present tense" };
// Creative latitude is fixed at "balanced" — it's no longer a user option.
const LATITUDE_TEXT =
  "Follow the director's instruction, using tasteful initiative on smaller details and texture.";
function maturityText(g) {
  if (!g || !g.adult) {
    return "Audience: general. Keep content broadly suitable — no graphic violence, no explicit sexual content, no strong profanity.";
  }
  // Phrase each dimension as an ACTIVE instruction for the chosen level, not a
  // passive ceiling — otherwise the model treats "permitted" as "may" and stays
  // clean. Profanity especially must be directed, or it never appears.
  const violence = [
    "Avoid graphic violence.",
    "Mild violence is fine where the story calls for it.",
    "Depict moderate violence directly when a scene calls for it; don't shy away from it.",
    "Render strong, graphic violence unflinchingly where the story calls for it.",
  ];
  const sexual = [
    "Avoid explicit sexual content.",
    "Mild romantic/sexual content is fine, kept non-explicit.",
    "Write moderate sexual content directly when a scene calls for it.",
    "Write explicit sexual content where the story calls for it.",
  ];
  const language = [
    "Avoid profanity.",
    "Let characters use occasional mild profanity where it fits naturally.",
    "Let characters swear naturally — use realistic profanity in dialogue when the moment calls for it; do not sanitize it.",
    "Have characters use strong, unsanitized profanity wherever it fits them and the situation; do not soften, bleep, or avoid swearing.",
  ];
  const lvl = (n) => Math.min(3, Math.max(0, Number(n) || 0));
  const parts = [
    "Audience: adults (18+). All characters are adults.",
    violence[lvl(g.violence)],
    sexual[lvl(g.sexual)],
    language[lvl(g.language)],
  ];
  if (g.erotica && g.sexual === 3) {
    parts.push(
      "This is an adult erotica work: lean strongly into the erotica genre, with explicit, consensual intimacy between adults as a central and recurring element of the story."
    );
  }
  parts.push("Keep all of this in service of the story and true to the characters — never gratuitous.");
  return parts.join(" ");
}

/**
 * Guide mode: the user is the director and supplies an instruction; the AI
 * writes the next ~275-word section of prose. Returns plain prose only.
 */
export async function guideStory({ title, author, guide, prompt, opening, recent, memory, whole, arc, sections, targetWords, bible, voiceSample, position, variety, variant, onDelta }) {
  const g = guide || {};
  const target = Math.max(150, Math.min(800, targetWords || 275));
  const maxTokens = Math.min(8192, Math.round(target * 2.2) + 256);
  const first = !recent && !whole;

  const system = [
    "You are the sole author of a novel. The user is the director: they tell you what should happen next, and you write the prose.",
    "",
    "Hard rules:",
    `- Write approximately ${target} words of polished narrative prose for this one section (within ~15%).`,
    `- Prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
    `- Narrate in ${POV_TEXT[g.pov] || POV_TEXT.third_limited}, ${TENSE_TEXT[g.tense] || TENSE_TEXT.past}.`,
    `- ${LATITUDE_TEXT}`,
    `- ${maturityText(g)}`,
    first
      ? "- This is the opening section of the book. Establish voice, character, and place with confidence."
      : "- Continue seamlessly from where the story left off; honor every established name, place, and fact. Do not recap or summarize.",
    `- ${NATURAL_PROSE}`,
    `- ${NATURAL_DIALOGUE}`,
    "- Output prose ONLY — no headings, no titles, no author's notes, no commentary, no markdown, no restating the instruction.",
  ].join("\n");

  const mem = memoryBlock(memory);
  const craft = craftNotes(memory);
  const titleLine = `Working title: "${title}"  ·  Credited author / director: ${author}`;
  const voice = voiceBlock(voiceSample);
  const body = whole
    ? `The complete story so far (continue from the very end):\n----------\n${whole}\n----------`
    : opening
    ? `How the book opens (for voice & characters):\n----------\n${opening}\n----------`
    : "";
  // The voice sample is stable per book, so it lives with the cacheable prefix.
  const manuscript = [voice, body].filter(Boolean).join("\n");
  const tail = [
    mem ? `Continuity notes (for consistency — do NOT copy verbatim):\n${mem}` : "",
    bibleBlock(bible),
    craft,
    recent && !whole
      ? `Most recent prose (continue directly from the end of this):\n----------\n${recent}\n----------`
      : "",
    position || "",
    variety || "",
    `The director's instruction for this next section:\n"""${prompt}"""`,
    arcBlock(arc, sections),
    variant || "",
    `\nWrite the next ~${target} words now.`,
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
// the whole document each turn. (Cache only kicks in above the model's minimum
// block size, so tiny early books simply send a single plain block.)
function cachedUserContent(titleLine, manuscript, tail) {
  if (manuscript && manuscript.length > 5000) {
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
function craftNotes(m) {
  if (!m) return "";
  const lines = [];
  if (m.critique) {
    const first = String(m.critique)
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (first) {
      lines.push(
        `The editor's current concern with the story — quietly improve on it through what you write; never name or address it in the prose: ${first}`
      );
    }
  }
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
export async function continueStory({ title, author, settings, opening, recent, memory, whole, arc, sections, targetWords, bible, voiceSample, position, variety, variant, onDelta }) {
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
    `- Write approximately ${target} words (within about 15%). This is a turn in a back-and-forth, not the whole rest of the book — leave room for the next writer.`,
    `- ${NATURAL_PROSE}`,
    `- ${NATURAL_DIALOGUE}`,
    "- Output prose ONLY. No chapter headings (unless the manuscript itself uses them), no titles, no author's notes, no quotation framing, no markdown, no commentary about the writing.",
    "- Do not wrap the passage in quotes. Begin mid-flow if that is what the text calls for.",
  ].join("\n");

  const craft = craftNotes(memory);
  const voice = voiceBlock(voiceSample);
  let content;
  if (whole) {
    const titleLine = `Working title: "${title}"  ·  Primary author: ${author}`;
    const manuscript = [
      voice,
      "The complete manuscript so far (continue directly from the very end; keep every character, place, and fact consistent with it):",
      "----------",
      whole,
      "----------",
    ]
      .filter(Boolean)
      .join("\n");
    const tail = [
      bibleBlock(bible),
      craft,
      position || "",
      variety || "",
      arcBlock(arc, sections),
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
      bibleBlock(bible),
      craft,
      "Most recent passage of the manuscript (continue directly from the end of this):",
      "----------",
      recent,
      "----------",
      "",
      position || "",
      variety || "",
      arcBlock(arc, sections),
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
 * Optional per-section polish: one careful line-editing pass over a freshly
 * generated section before it's committed. A polish, never a rewrite — story
 * events, facts, and length stay put; the sentences get better.
 */
export async function selfEditSection({ title, mode, guide, draft, memory, lint, onDelta }) {
  const target = Math.max(20, wc(draft));
  const maxTokens = Math.min(8192, Math.round(target * 2.2) + 256);

  const system = [
    "You are the novelist giving a just-written passage ONE careful line-editing pass before it goes into the book. This is a polish, not a rewrite.",
    "",
    "Hard rules:",
    "- Keep every story event, fact, name, and the meaning of every line of dialogue intact. Add no plot; remove no plot.",
    `- Keep the length within about 10% of the original (~${target} words).`,
    "- Improve the sentences: vary rhythm and length, cut filler and reflexive thematic summing-up, trim decoration that carries no weight, fix clunky or repetitive phrasing.",
    "- If a do-not-reuse imagery list is provided, replace any phrase in the passage that reuses or closely echoes an entry.",
    sectionVoiceRules(mode, guide),
    `- ${NATURAL_PROSE}`,
    "- If the passage already reads well, change very little — a light hand beats a heavy one.",
    "- Output the final prose ONLY — no notes, no commentary, no markdown, no explanation of what changed.",
  ].join("\n");

  const craft = craftNotes(memory);
  const lintLines = Array.isArray(lint) && lint.length
    ? `A mechanical scan flagged these specific tells in the passage — repair each one:\n${lint
        .map((l) => `- ${l}`)
        .join("\n")}`
    : "";
  const user = [
    `Working title: "${title}"`,
    craft,
    lintLines,
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
  before,
  passage,
  after,
  memory,
  bible,
  onDelta,
}) {
  const target = Math.max(20, wc(passage));
  const maxTokens = Math.min(8192, Math.round(target * 2.6) + 512);

  const system = [
    "You are revising ONE passage inside a novel-in-progress, at the author's request.",
    "",
    "Hard rules:",
    "- Rewrite ONLY the marked passage. It must still read seamlessly out of the text before it and into the text after it — do not repeat, contradict, or re-set-up either.",
    "- Follow the author's instruction faithfully; it is the whole point of this rewrite.",
    `- Keep roughly the passage's current length (~${target} words, within about 20%) unless the instruction asks for shorter or longer.`,
    "- Honor established continuity: names, relationships, locations, timeline, planted details.",
    sectionVoiceRules(mode, guide),
    `- ${NATURAL_PROSE}`,
    `- ${NATURAL_DIALOGUE}`,
    "- Output the rewritten passage ONLY — no headings, notes, commentary, or markdown.",
  ].join("\n");

  const mem = memoryBlock(memory);
  const user = [
    `Working title: "${title}"  ·  Author: ${author}`,
    mem ? `Continuity notes (for consistency — do NOT copy verbatim):\n${mem}` : "",
    bibleBlock(bible),
    before
      ? `The text immediately BEFORE the passage (unchanged — flow out of its ending):\n----------\n${before}\n----------`
      : "This passage opens the book.",
    `The passage to rewrite:\n----------\n${passage}\n----------`,
    after
      ? `The text immediately AFTER the passage (unchanged — your rewrite must flow into it):\n----------\n${after}\n----------`
      : "Nothing follows this passage yet.",
    `The author's instruction for the rewrite:\n"""${instruction}"""`,
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
export async function pickTake({ title, a, b }) {
  const system = [
    "You are a sharp fiction editor comparing two takes of the same section of a novel. Pick the take that reads more like a human novelist wrote it.",
    "Judge by: varied, natural sentence rhythm; freedom from AI tells (the \"not X, but Y\" contrast, rule-of-three lists, dramatic one-line paragraph buttons, stock body language, tidy aphoristic endings); specificity and surprise over safe competence; dialogue that sounds spoken; and coherent continuation of the story. A rougher take that sounds human beats a smoother take that sounds generated.",
    "Respond with EXACTLY one character: A or B. No other text.",
  ].join("\n");
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

  const res = await client().messages.create(
    tuned({ model: ANALYSIS_MODEL, max_tokens: 4, system, messages: [{ role: "user", content: user }] }, 0)
  );
  const raw = joinText(res.content).trim().toUpperCase();
  return raw.startsWith("B") ? "B" : "A";
}

/**
 * Honest revision pass: rewrite the WHOLE manuscript to address the editor's
 * critique and genuinely raise the story's quality (target 90+), preserving the
 * core story, voice, and chapter structure. Streams the rewritten manuscript
 * (with `## Chapter` markers). The result is re-scored normally — nothing here
 * touches or fakes the score; it only improves the substance.
 */
export async function reviseManuscript({ title, author, guide, mode, fullText, critique, quality, score, onDelta }) {
  const g = guide || {};
  const voice =
    mode === "guide"
      ? [
          `- Prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
          `- Narrate in ${POV_TEXT[g.pov] || POV_TEXT.third_limited}, ${TENSE_TEXT[g.tense] || TENSE_TEXT.past}.`,
          `- ${maturityText(g)}`,
        ].join("\n")
      : "- Preserve the established voice, point of view, tense, and tone of the manuscript.";

  const system = [
    "You are a master editor performing a full revision pass on a COMPLETED manuscript.",
    "The author wants the STORY raised to at least 90/100 by GENUINELY fixing its weaknesses — never by padding, inflating, flattering, or gaming a score. Improve substance, not length.",
    "",
    "Your task:",
    "- Rewrite the ENTIRE manuscript from start to finish. Keep it recognizably the same book — its central characters and the spirit of its premise — but you have broad license to take BOLD liberties with the PLOT and STRUCTURE wherever that raises the impact: reorder or rebuild scenes, change what happens, add or cut beats and subplots, reframe the conflict, and reshape the arc and ending. Favor a stronger story over fidelity to the original sequence of events.",
    "- Directly address every weakness in the editor's critique below: deepen characters and motivation, sharpen and raise the stakes, fix pacing, resolve loose threads, cut slack, and land a satisfying, earned ending.",
    "- Restructure scenes, add or remove material, merge or split passages, invent new connective plot, and rework any line — whatever genuinely serves the story. Be willing to change WHAT HAPPENS, not just how it is worded.",
    "- Keep the chapter structure flexible: emit a line `## Chapter` (or `## Chapter: Title`) at the start of each chapter, then its prose. You may re-divide chapters where the new structure calls for it.",
    voice,
    `- ${NATURAL_PROSE}`,
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
export async function revisionPlan({ title, fullText, critique, quality, score }) {
  const system = [
    "You are a ruthless, brilliant developmental editor. Read the complete manuscript and the editor's critique, then produce a REVISION PLAN to raise the STORY to at least 90/100.",
    "First diagnose what is actually CAPPING the score — the story-level and structural limits: weak, abstract, or low stakes; thin, passive, or static characters; slack or shapeless structure; a predictable, convenient, or unearned arc; a flat or rushed ending; missing consequences and tension. This is NOT about prose — polished sentences alone will never move the score.",
    "Then prescribe BOLD, specific, high-impact fixes grounded in THIS story: sharpen and concretize the stakes, give the protagonist a real arc with genuine cost and change, restructure and cut dead weight, add complication and reversal, plant and pay off, and build to a powerful, earned ending. Take real liberties with the PLOT and STRUCTURE for impact — reorder events, change outcomes, add or remove scenes and subplots, and reshape the arc. Keep the central characters and the spirit of the premise, but do not be precious about the original sequence of events; change WHAT HAPPENS, not just how it is worded.",
    "Output a tight numbered list (6-12 items), each a concrete change. No preamble, no praise — just the list.",
  ].join("\n");
  const user = [
    `Title: "${title}"`,
    quality ? `Current assessment: ${quality}` : "",
    typeof score === "number" ? `Current score: ${score}/100.` : "",
    critique ? `Critique to address:\n${critique}` : "",
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
  const text = await runText(
    tuned({ model: REVISE_MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: user }] }, 0.5)
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
  onDelta,
}) {
  const g = guide || {};
  const voice =
    mode === "guide"
      ? [
          `- Prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
          `- Narrate in ${POV_TEXT[g.pov] || POV_TEXT.third_limited}, ${TENSE_TEXT[g.tense] || TENSE_TEXT.past}.`,
          `- ${maturityText(g)}`,
        ].join("\n")
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
    "- Preserve `## Chapter` markers: emit a `## Chapter` (or `## Chapter: Title`) line exactly where a chapter begins in the source part.",
    isLast ? "- This is the FINAL part — deliver a powerful, earned, fully resolved ending." : "",
    voice,
    `- ${NATURAL_PROSE}`,
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

export async function analyzeStory({ title, fullText, prior, guide, eroticaLean, arc, sections, final }) {
  const showArc = !final && Array.isArray(arc) && arc.filter((h) => h && h.text).length > 0;
  const hasArc = showArc;
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
      ? '  "critique":  A thorough, candid critique of the FINISHED STORY as a whole (not the prose), knowing it is complete and nothing more will be added. 3-4 substantial points, each 2-3 sentences, newline-separated (no bullet characters). Name each weakness precisely, ground it in the text, and explain how it limits the completed work — unresolved threads, an underdeveloped or unearned arc, a rushed ending, pacing across the whole, etc. Do NOT critique prose or writing craft, and do NOT propose future additions.'
      : '  "critique":  A thorough, candid critique of the finished work as a whole, knowing it is complete. 3-4 substantial points, each 2-3 sentences, newline-separated (no bullet characters). Name each weakness precisely, ground it in the text, and explain how it limits the completed work. Do NOT propose future additions.'
    : guide
    ? '  "critique":  A thorough, candid critique of the STORY (not the prose). Write 3-4 substantial points, each 2-3 sentences, newline-separated (no bullet characters). For each: name the weakness precisely, ground it in a specific moment, character, or pattern actually in the text, and explain why it weakens the story or holds back the score (e.g. thin or abstract stakes, an underdeveloped character or motivation, slack pacing, a predictable turn, tonal inconsistency, an unearned development). Be specific, perceptive, and constructive — this is the most valuable part of the notes, so spend real care on it. Do NOT critique the prose or writing craft.'
    : '  "critique":  A thorough, candid critique. Write 3-4 substantial points, each 2-3 sentences, newline-separated (no bullet characters). For each: name the weakness precisely, ground it in a specific moment or pattern in the text, and explain why it holds the work back. Be specific, perceptive, and constructive — this is the most valuable part of the notes, so spend real care on it.';
  const suggestionsLine = guide
    ? '  "suggestions": 2-3 concrete ideas for the NEXT section that would directly address the weaknesses raised in the critique. Newline-separated (no bullet characters). Phrase each as a usable direction (what could happen next), make the three genuinely different from one another, and have each clearly tackle a specific critique point.'
    : '  "suggestions": 2-3 concrete ideas for what to write NEXT that would directly address the weaknesses raised in the critique. Newline-separated (no bullet characters). Phrase each as a usable prompt, make them genuinely different, and have each clearly tackle a specific critique point.';
  const system = [
    "You are a perceptive editor maintaining notes on a manuscript-in-progress.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences, no preamble.",
    `Use exactly these keys, IN THIS ORDER (all strings except qualityScore): style, genre, synopsis, quality, qualityScore, critique, ${
      final ? "" : "nextDirection, suggestions, "
    }${hasArc ? "arcProgress, arcDone, " : ""}${final ? "" : "motifs, voices, "}continuity.`,
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
    final
      ? ""
      : '  "nextDirection": ONE complete sentence (at most ~35 words) the author could use as the instruction for the next section — phrased as a direction (what should happen next), not a summary. It must be a finished sentence ending in punctuation. Build naturally on where the story just left off.',
    final ? "" : suggestionsLine,
    hasArc ? arcProgressLine : "",
    hasArc ? arcDoneLine : "",
    final
      ? ""
      : '  "motifs": The most distinctive images, metaphors, sensory details, pet phrases, AND sentence constructions the manuscript has ALREADY leaned on — especially anything used more than once, weighting the most recent sections heavily. Constructions count: a repeated "not X, but Y" contrast, a signature rhythm, a recurring way of ending scenes. 4-8 short fragments (each under ~10 words), newline-separated, no bullets or numbering. These are shown to the writer as a do-not-reuse list, so include only genuinely distinctive wording or patterns (never ordinary words or common actions).',
    final
      ? ""
      : '  "voices": For the 2-4 characters most present in the recent material: one compact line each in the form "Name: how they talk" — diction, rhythm, verbal habits, what they avoid saying. Newline-separated. These keep dialogue voices distinct, so make them specific and contrastive with one another; carry forward and refine prior entries for characters not in the excerpt.',
    '  "continuity": a COMPACT running record for consistency — cast (names + a few words each), key places, key facts, open threads. Newline-separated short lines. Keep it under ~900 characters; prune the least important details to stay within that. This key comes LAST.',
    "",
    final
      ? "You are given the COMPLETE, FINISHED manuscript below — the author has marked the book as ended and nothing more will be added. Evaluate it as a finished whole."
      : "IMPORTANT: You may be shown a prior continuity record plus an excerpt of the manuscript (the opening and the most recent material; the middle may be omitted). Treat the prior record as authoritative for things you cannot currently see: carry every still-valid character and fact forward, and ADD or UPDATE based on the new material. Never drop an established character just because they don't appear in the excerpt.",
    eroticaLean
      ? "This is an adult erotica work (all characters are adults): the genre should reflect that, and nextDirection should lean into intimate, erotic developments between adults."
      : "",
    "Keep every field concise so the whole object stays small. Be specific and honest.",
  ]
    .filter(Boolean)
    .join("\n");

  const priorContinuity = prior && prior.continuity ? String(prior.continuity).slice(0, 1600) : "";
  const priorBlock = prior
    ? [
        "Prior continuity record (carry forward; update, do not discard):",
        priorContinuity || "(none yet)",
        prior.synopsis ? `Prior synopsis: ${prior.synopsis}` : "",
        "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const user = [
    `Working title: "${title}"`,
    "",
    priorBlock,
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

  const res = await client().messages.create(
    tuned(
      {
        model: ANALYSIS_MODEL,
        max_tokens: 2600, // headroom for the in-depth critique, suggestions, and growing continuity
        system,
        messages: [{ role: "user", content: user }],
      },
      0.3
    )
  );

  let raw = joinText(res.content);
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
  const suggestions = final ? "" : getStr("suggestions").trim();
  const motifs = final ? "" : getStr("motifs").trim().slice(0, 700);
  const voices = final ? "" : getStr("voices").trim().slice(0, 600);
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
    nextDirection: nextDirection || (prior && prior.nextDirection) || "",
    suggestions: final ? "" : suggestions || (prior && prior.suggestions) || "",
    motifs: final ? "" : motifs || (prior && prior.motifs) || "",
    voices: final ? "" : voices || (prior && prior.voices) || "",
    arcProgress: arcProgress || (hasArc && prior && prior.arcProgress) || "",
    arcDone,
    continuity,
    final: Boolean(final),
    updatedAt: Date.now(),
  };
}
