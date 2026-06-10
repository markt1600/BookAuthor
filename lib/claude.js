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
export async function analyzeStory({ title, fullText, prior }) {
  const system = [
    "You are a perceptive editor maintaining notes on a manuscript-in-progress.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences, no preamble.",
    "Use exactly these keys, IN THIS ORDER (all strings except qualityScore):",
    '  "style":     1-2 sentences describing the writing style and narrative voice.',
    '  "genre":     a short genre label (e.g. "Literary horror", "Cozy mystery").',
    '  "synopsis":  2-4 sentences summarizing the story so far.',
    '  "quality":   1-2 sentences of candid, constructive assessment of the craft.',
    '  "qualityScore": an integer 1-100 reflecting current craft quality.',
    '  "continuity": a COMPACT running record for consistency — cast (names + a few words each), key places, key facts, open threads. Newline-separated short lines. Keep it under ~900 characters; prune the least important details to stay within that. This key comes LAST.',
    "",
    "IMPORTANT: You may be shown a prior continuity record plus an excerpt of the manuscript (the opening and the most recent material; the middle may be omitted). Treat the prior record as authoritative for things you cannot currently see: carry every still-valid character and fact forward, and ADD or UPDATE based on the new material. Never drop an established character just because they don't appear in the excerpt.",
    "Keep every field concise so the whole object stays small. Be specific and honest.",
  ].join("\n");

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
  let continuity = getStr("continuity").trim();
  if (!continuity) continuity = priorContinuity;
  if (continuity.length > 1600) continuity = continuity.slice(0, 1600).trim();
  let score = getNum("qualityScore");
  score = Number.isFinite(score) ? Math.min(100, Math.max(1, Math.round(score))) : null;

  // If we recovered nothing usable, keep the previous analysis (return null).
  if (!style && !genre && !synopsis && !quality && score == null && !continuity) {
    return null;
  }

  return {
    style: style || (prior && prior.style) || "",
    genre: genre || (prior && prior.genre) || "",
    synopsis: synopsis || (prior && prior.synopsis) || "",
    quality: quality || (prior && prior.quality) || "",
    qualityScore: score != null ? score : prior ? prior.qualityScore : null,
    continuity,
    updatedAt: Date.now(),
  };
}
