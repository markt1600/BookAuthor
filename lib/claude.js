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
  "Write like a human novelist, not an AI. Not every sentence wants to be profound, and not every observation needs to be filtered through an elegant metaphor or simile — let plain, declarative sentences carry their share, and let some moments stay ordinary. Vary sentence rhythm and length; resist ending beats on a tidy aphorism or a portentous one-line paragraph. In particular, avoid the over-used \"the way a thing does X when Y\" construction (e.g. \"the way the light caught the glass when no one was looking\") — it is a telltale AI tic; reach for it rarely, if ever. Trust concrete detail, action, and dialogue over decoration, and cut reflexive thematic summing-up.";

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
export async function guideStory({ title, author, guide, prompt, opening, recent, memory, whole, arc, sections, targetWords, onDelta }) {
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
    "- Output prose ONLY — no headings, no titles, no author's notes, no commentary, no markdown, no restating the instruction.",
  ].join("\n");

  const mem = memoryBlock(memory);
  const titleLine = `Working title: "${title}"  ·  Credited author / director: ${author}`;
  const manuscript = whole
    ? `The complete story so far (continue from the very end):\n----------\n${whole}\n----------`
    : opening
    ? `How the book opens (for voice & characters):\n----------\n${opening}\n----------`
    : "";
  const tail = [
    mem ? `Continuity notes (for consistency — do NOT copy verbatim):\n${mem}` : "",
    recent && !whole
      ? `Most recent prose (continue directly from the end of this):\n----------\n${recent}\n----------`
      : "",
    `The director's instruction for this next section:\n"""${prompt}"""`,
    arcBlock(arc, sections),
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

/**
 * Continue the manuscript in the established voice, aiming for ~targetWords.
 * The model is given a cumulative continuity record (so early characters and
 * details from chapters far behind the recent window aren't forgotten), the
 * book's opening, and the most recent passages. Returns plain prose only.
 */
export async function continueStory({ title, author, settings, opening, recent, memory, whole, arc, sections, targetWords, onDelta }) {
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
    "- Output prose ONLY. No chapter headings (unless the manuscript itself uses them), no titles, no author's notes, no quotation framing, no markdown, no commentary about the writing.",
    "- Do not wrap the passage in quotes. Begin mid-flow if that is what the text calls for.",
  ].join("\n");

  let content;
  if (whole) {
    const titleLine = `Working title: "${title}"  ·  Primary author: ${author}`;
    const manuscript = [
      "The complete manuscript so far (continue directly from the very end; keep every character, place, and fact consistent with it):",
      "----------",
      whole,
      "----------",
    ].join("\n");
    const tail = `${arcBlock(arc, sections) ? arcBlock(arc, sections) + "\n\n" : ""}Now write the next ~${target} words, continuing seamlessly.`;
    content = cachedUserContent(titleLine, manuscript, tail);
  } else {
    const mem = memoryBlock(memory);
    const titleLine = `Working title: "${title}"  ·  Primary author: ${author}`;
    const manuscript = opening
      ? `How the book opens (for founding voice & characters — do NOT continue from here):\n----------\n${opening}\n----------`
      : "";
    const tail = [
      mem ? `Continuity notes (for consistency — do NOT copy verbatim into the prose):\n${mem}` : "",
      "Most recent passage of the manuscript (continue directly from the end of this):",
      "----------",
      recent,
      "----------",
      "",
      arcBlock(arc, sections),
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
    }${hasArc ? "arcProgress, arcDone, " : ""}continuity.`,
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
    arcProgress: arcProgress || (hasArc && prior && prior.arcProgress) || "",
    arcDone,
    continuity,
    final: Boolean(final),
    updatedAt: Date.now(),
  };
}
