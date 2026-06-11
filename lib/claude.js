import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

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

const STYLE_PROMPT = {
  literary:
    "Literary fiction — lyrical, image-rich, psychologically interior; let subtext and rhythm carry meaning.",
  cinematic:
    "Cinematic — vivid, propulsive, scene-driven prose with strong visual blocking and momentum.",
  cozy: "Cozy — warm, gentle, character-forward; low menace, comforting texture and small detail.",
  noir: "Noir / hardboiled — terse, shadowed, wry; clipped sentences, moral ambiguity, heavy atmosphere.",
  whimsical: "Whimsical / fairy-tale — playful, lightly ornate, wonder-filled, with a storyteller's lilt.",
  adventure: "Pulp adventure — fast, energetic, plot-driving; clear action and steadily rising stakes.",
  gothic: "Gothic — ornate, eerie, atmospheric; dread, decay, and heightened emotion.",
  minimalist: "Minimalist — spare, restrained, concrete; short sentences, white space, understatement.",
};
const POV_TEXT = {
  first: "first person",
  third_limited: "third person limited",
  third_omniscient: "third person omniscient",
};
const TENSE_TEXT = { past: "past tense", present: "present tense" };
const LATITUDE_TEXT = {
  tight:
    "Follow the director's instruction closely; do not introduce major new events, characters, or turns they did not ask for.",
  balanced: "Follow the director's instruction, using tasteful initiative on smaller details and texture.",
  bold: "Follow the spirit of the director's instruction and take confident creative risks to make the scene vivid and surprising.",
};
function maturityText(g) {
  if (!g || !g.adult) {
    return "Audience: general. Keep content broadly suitable — no graphic violence, no explicit sexual content, no strong profanity.";
  }
  const lv = ["none", "mild", "moderate", "strong"];
  const parts = [
    "Audience: adults (18+). All characters are adults.",
    `Permitted intensity — violence/gore: ${lv[g.violence]}; sexual content: ${lv[g.sexual]}; profanity: ${lv[g.language]}.`,
  ];
  if (g.erotica && g.sexual === 3) {
    parts.push(
      "This is an adult erotica work: lean strongly into the erotica genre, with explicit, consensual intimacy between adults as a central and recurring element of the story."
    );
  }
  parts.push("Stay within these intensities, keep it in service of the story, and follow content guidelines.");
  return parts.join(" ");
}

/**
 * Guide mode: the user is the director and supplies an instruction; the AI
 * writes the next ~275-word section of prose. Returns plain prose only.
 */
export async function guideStory({ title, author, guide, prompt, opening, recent, memory, whole, targetWords }) {
  const g = guide || {};
  const target = Math.max(200, Math.min(360, targetWords || 275));
  const maxTokens = Math.min(4096, Math.round(target * 2.2) + 256);
  const first = !recent && !whole;

  const system = [
    "You are the sole author of a novel. The user is the director: they tell you what should happen next, and you write the prose.",
    "",
    "Hard rules:",
    `- Write approximately ${target} words of polished narrative prose for this one section (within ~15%).`,
    `- Prose style: ${STYLE_PROMPT[g.style] || STYLE_PROMPT.literary}`,
    `- Narrate in ${POV_TEXT[g.pov] || POV_TEXT.third_limited}, ${TENSE_TEXT[g.tense] || TENSE_TEXT.past}.`,
    `- ${LATITUDE_TEXT[g.latitude] || LATITUDE_TEXT.balanced}`,
    `- ${maturityText(g)}`,
    first
      ? "- This is the opening section of the book. Establish voice, character, and place with confidence."
      : "- Continue seamlessly from where the story left off; honor every established name, place, and fact. Do not recap or summarize.",
    "- Output prose ONLY — no headings, no titles, no author's notes, no commentary, no markdown, no restating the instruction.",
  ].join("\n");

  const mem = memoryBlock(memory);
  const user = [
    `Working title: "${title}"  ·  Credited author / director: ${author}`,
    mem ? `\nContinuity notes (for consistency — do NOT copy verbatim):\n${mem}` : "",
    whole
      ? `\nThe complete story so far (continue from the very end):\n----------\n${whole}\n----------`
      : opening
      ? `\nHow the book opens (for voice & characters):\n----------\n${opening}\n----------`
      : "",
    recent && !whole
      ? `\nMost recent prose (continue directly from the end of this):\n----------\n${recent}\n----------`
      : "",
    `\nThe director's instruction for this next section:\n"""${prompt}"""`,
    `\nWrite the next ~${target} words now.`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature: 0.92,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = joinText(res.content);
  if (!text) throw new Error("The AI author returned an empty section.");
  return text;
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
export async function continueStory({ title, author, settings, opening, recent, memory, whole, targetWords }) {
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
    "- Output prose ONLY. No chapter headings (unless the manuscript itself uses them), no titles, no author's notes, no quotation framing, no markdown, no commentary about the writing.",
    "- Do not wrap the passage in quotes. Begin mid-flow if that is what the text calls for.",
  ].join("\n");

  let user;
  if (whole) {
    user = [
      `Working title: "${title}"  ·  Primary author: ${author}`,
      "",
      "The complete manuscript so far (continue directly from the very end; keep every character, place, and fact consistent with it):",
      "----------",
      whole,
      "----------",
      "",
      `Now write the next ~${target} words, continuing seamlessly.`,
    ].join("\n");
  } else {
    const mem = memoryBlock(memory);
    user = [
      `Working title: "${title}"  ·  Primary author: ${author}`,
      mem ? `\nContinuity notes (for consistency — do NOT copy verbatim into the prose):\n${mem}` : "",
      opening
        ? `\nHow the book opens (for founding voice & characters — do NOT continue from here):\n----------\n${opening}\n----------`
        : "",
      "\nMost recent passage of the manuscript (continue directly from the end of this):",
      "----------",
      recent,
      "----------",
      "",
      `Now write the next ~${target} words, continuing seamlessly and consistently with everything above.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature: 0.92,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = joinText(res.content);
  if (!text) throw new Error("The AI author returned an empty continuation.");
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

export async function analyzeStory({ title, fullText, prior, guide, eroticaLean }) {
  const qualityLine = guide
    ? '  "quality":   1-2 sentences assessing the STORY ITSELF — momentum, characters, structure, stakes, and the strength of the director\'s choices. Do NOT comment on prose style or writing craft (an AI wrote the prose; never praise or critique the writing itself).'
    : '  "quality":   1-2 sentences of candid, constructive assessment of the craft.';
  const scoreLine = guide
    ? '  "qualityScore": an integer 1-100 reflecting the strength of the STORY and the direction (not the prose quality).'
    : '  "qualityScore": an integer 1-100 reflecting current craft quality.';
  const system = [
    "You are a perceptive editor maintaining notes on a manuscript-in-progress.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences, no preamble.",
    "Use exactly these keys, IN THIS ORDER (all strings except qualityScore): style, genre, synopsis, quality, qualityScore, nextDirection, continuity.",
    guide
      ? '  "style":     1-2 sentences neutrally describing the prose voice and narration (descriptive only).'
      : '  "style":     1-2 sentences describing the writing style and narrative voice.',
    '  "genre":     a short genre label (e.g. "Literary horror", "Cozy mystery").',
    '  "synopsis":  2-4 sentences summarizing the story so far.',
    qualityLine,
    scoreLine,
    '  "nextDirection": ONE complete sentence (at most ~35 words) the author could use as the instruction for the next section — phrased as a direction (what should happen next), not a summary. It must be a finished sentence ending in punctuation. Build naturally on where the story just left off.',
    '  "continuity": a COMPACT running record for consistency — cast (names + a few words each), key places, key facts, open threads. Newline-separated short lines. Keep it under ~900 characters; prune the least important details to stay within that. This key comes LAST.',
    "",
    "IMPORTANT: You may be shown a prior continuity record plus an excerpt of the manuscript (the opening and the most recent material; the middle may be omitted). Treat the prior record as authoritative for things you cannot currently see: carry every still-valid character and fact forward, and ADD or UPDATE based on the new material. Never drop an established character just because they don't appear in the excerpt.",
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
    "Manuscript (opening and most recent material; middle may be omitted on long books):",
    "----------",
    fullText,
    "----------",
    "",
    "Return the JSON object now.",
  ].join("\n");

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1800, // headroom so the growing continuity record can't truncate the object
    temperature: 0.3,
    system,
    messages: [{ role: "user", content: user }],
  });

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
  let nextDirection = clipSentence(getStr("nextDirection").trim(), 360);
  let continuity = getStr("continuity").trim();
  if (!continuity) continuity = priorContinuity;
  if (continuity.length > 1600) continuity = continuity.slice(0, 1600).trim();
  let score = getNum("qualityScore");
  score = Number.isFinite(score) ? Math.min(100, Math.max(1, Math.round(score))) : null;

  // If we recovered nothing usable, keep the previous analysis (return null).
  if (!style && !genre && !synopsis && !quality && score == null && !continuity && !nextDirection) {
    return null;
  }

  return {
    style: style || (prior && prior.style) || "",
    genre: genre || (prior && prior.genre) || "",
    synopsis: synopsis || (prior && prior.synopsis) || "",
    quality: quality || (prior && prior.quality) || "",
    qualityScore: score != null ? score : prior ? prior.qualityScore : null,
    nextDirection: nextDirection || (prior && prior.nextDirection) || "",
    continuity,
    updatedAt: Date.now(),
  };
}
