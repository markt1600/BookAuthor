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

/**
 * Continue the manuscript in the established voice, aiming for ~targetWords.
 * Returns plain prose only (no headings, no commentary).
 */
export async function continueStory({ title, author, settings, context, targetWords }) {
  const target = Math.max(20, Math.min(2000, targetWords || 150));
  // ~1.5 tokens/word for English prose, plus headroom.
  const maxTokens = Math.min(4096, Math.round(target * 2.2) + 256);

  const system = [
    "You are a co-author silently continuing someone else's novel-in-progress.",
    "You will be given the most recent passage. Continue the story from exactly where it ends.",
    "",
    "Hard rules:",
    "- Match the established voice, tense, point of view, diction, pacing, and genre. Do not reset or 'improve' the style.",
    "- Continue the narrative forward. Do not summarize, recap, or restate what already happened.",
    `- Write approximately ${target} words (within about 15%). This is a turn in a back-and-forth, not the whole rest of the book — leave room for the next writer.`,
    "- Output prose ONLY. No chapter headings (unless the manuscript itself uses them), no titles, no author's notes, no quotation framing, no markdown, no commentary about the writing.",
    "- Do not wrap the passage in quotes. Begin mid-flow if that is what the text calls for.",
  ].join("\n");

  const user = [
    `Working title: "${title}"  ·  Primary author: ${author}`,
    "",
    "Most recent passage of the manuscript (continue directly from the end of this):",
    "----------",
    context,
    "----------",
    "",
    `Now write the next ~${target} words, continuing seamlessly.`,
  ].join("\n");

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature: 0.92,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = joinText(res.content);
  if (!text) throw new Error("Claude returned an empty continuation.");
  return text;
}

/**
 * Read the manuscript and return a structured assessment. Returns null on
 * parse failure so a flaky analysis never blocks the writing flow.
 */
export async function analyzeStory({ title, fullText }) {
  const system = [
    "You are a perceptive editor reading a manuscript-in-progress.",
    "Respond with a single JSON object and nothing else — no markdown, no code fences, no preamble.",
    "Keys (all strings except qualityScore):",
    '  "style":     1-2 sentences describing the writing style and narrative voice.',
    '  "genre":     a short genre label (e.g. "Literary horror", "Cozy mystery").',
    '  "synopsis":  2-4 sentences summarizing the story so far.',
    '  "quality":   1-2 sentences of candid, constructive assessment of the craft.',
    '  "qualityScore": an integer 1-100 reflecting current craft quality.',
    "Be specific and honest. Judge the manuscript as it stands.",
  ].join("\n");

  const user = [
    `Working title: "${title}"`,
    "",
    "Manuscript so far:",
    "----------",
    fullText,
    "----------",
    "",
    "Return the JSON object now.",
  ].join("\n");

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 700,
    temperature: 0.3,
    system,
    messages: [{ role: "user", content: user }],
  });

  let raw = joinText(res.content);
  // Strip accidental code fences just in case.
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // Grab the outermost JSON object if there is surrounding prose.
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1) raw = raw.slice(first, last + 1);

  try {
    const parsed = JSON.parse(raw);
    let score = Number(parsed.qualityScore);
    if (!Number.isFinite(score)) score = null;
    else score = Math.min(100, Math.max(1, Math.round(score)));
    return {
      style: String(parsed.style || "").trim(),
      genre: String(parsed.genre || "").trim(),
      synopsis: String(parsed.synopsis || "").trim(),
      quality: String(parsed.quality || "").trim(),
      qualityScore: score,
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}
