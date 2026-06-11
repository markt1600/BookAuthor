import { randomBytes } from "crypto";

const ID_ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz"; // no l/o to avoid confusion

export function newId(len = 12) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export function countWords(text) {
  if (!text) return 0;
  const m = String(text).trim().match(/\S+/g);
  return m ? m.length : 0;
}

// The list of choices the UI offers. Kept here so the API can validate too.
export const CHOICES = {
  cover: ["classic", "minimal", "noir", "parchment", "botanical", "blueprint"],
  format: ["portrait", "square", "landscape"],
  material: ["paper", "parchment", "linen", "newsprint", "midnight"],
  font: ["serif", "sans", "mono", "storybook", "cursive"],
};

export const DEFAULT_SETTINGS = {
  cover: "classic",
  format: "portrait",
  material: "paper",
  font: "serif",
  fontSize: 19, // px, on-screen reading size for the page surface
  inkColor: "", // "" = use the material's default ink; otherwise a hex override
  fullContext: false, // send the entire manuscript to the model each turn
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function clampSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  for (const key of ["cover", "format", "material", "font"]) {
    if (!CHOICES[key].includes(s[key])) s[key] = DEFAULT_SETTINGS[key];
  }
  let size = Number(s.fontSize);
  if (!Number.isFinite(size)) size = DEFAULT_SETTINGS.fontSize;
  s.fontSize = Math.min(28, Math.max(14, Math.round(size)));
  s.inkColor = typeof s.inkColor === "string" && HEX.test(s.inkColor.trim()) ? s.inkColor.trim() : "";
  s.fullContext = Boolean(s.fullContext);
  return s;
}

// ---- Guide mode (the user directs, the AI writes all the prose) ----
export const GUIDE_CHOICES = {
  style: ["literary", "cinematic", "cozy", "noir", "whimsical", "adventure", "gothic", "minimalist"],
  pov: ["first", "third_limited", "third_omniscient"],
  tense: ["past", "present"],
  latitude: ["tight", "balanced", "bold"],
};

export const GUIDE_LABELS = {
  style: {
    literary: "Literary",
    cinematic: "Cinematic",
    cozy: "Cozy",
    noir: "Noir",
    whimsical: "Whimsical",
    adventure: "Adventure",
    gothic: "Gothic",
    minimalist: "Minimalist",
  },
  pov: { first: "First person", third_limited: "Third — limited", third_omniscient: "Third — omniscient" },
  tense: { past: "Past tense", present: "Present tense" },
  latitude: { tight: "Follow me closely", balanced: "Balanced", bold: "Take creative risks" },
  intensity: ["None", "Mild", "Moderate", "Strong"],
};

export const DEFAULT_GUIDE = {
  style: "literary",
  pov: "third_limited",
  tense: "past",
  latitude: "balanced",
  sectionWords: 275, // 150..400 — length of each AI-written section
  adult: false,
  violence: 0, // 0..3
  sexual: 0,
  language: 0,
  erotica: false, // adult + explicitness at max → strong lean toward the erotica genre
};

export function clampGuide(input = {}) {
  const g = { ...DEFAULT_GUIDE, ...(input || {}) };
  for (const k of ["style", "pov", "tense", "latitude"]) {
    if (!GUIDE_CHOICES[k].includes(g[k])) g[k] = DEFAULT_GUIDE[k];
  }
  g.adult = Boolean(g.adult);
  let sw = Number(g.sectionWords);
  if (!Number.isFinite(sw)) sw = 275;
  g.sectionWords = Math.min(400, Math.max(150, Math.round(sw)));
  for (const k of ["violence", "sexual", "language"]) {
    let n = Number(g[k]);
    if (!Number.isInteger(n)) n = 0;
    g[k] = Math.min(3, Math.max(0, n));
    if (!g.adult) g[k] = 0; // intensities only apply to adult books
  }
  g.erotica = Boolean(g.erotica) && g.adult; // only meaningful for adult books
  return g;
}

// Chapters: ordered breaks, each beginning at a turn index. Title is editable.
export function normalizeChapters(chapters, turnsLen) {
  if (!Array.isArray(chapters)) return [];
  const seen = new Set();
  const out = [];
  for (const c of chapters) {
    if (!c || typeof c !== "object") continue;
    let start = Number(c.startTurn);
    if (!Number.isInteger(start)) continue;
    start = Math.max(0, Math.min(start, Math.max(0, turnsLen - 1)));
    if (seen.has(start)) continue;
    seen.add(start);
    out.push({
      id: typeof c.id === "string" && c.id ? c.id : newId(6),
      title: typeof c.title === "string" ? c.title.slice(0, 120) : "",
      startTurn: start,
    });
  }
  out.sort((a, b) => a.startTurn - b.startTurn);
  return out;
}

export function newBook({ title, author, settings, mode, guide } = {}) {
  const now = Date.now();
  return {
    id: newId(),
    title: (title || "").trim() || "Untitled",
    author: (author || "").trim() || "Anonymous",
    mode: mode === "guide" ? "guide" : "participate",
    settings: clampSettings(settings),
    guide: clampGuide(guide),
    turns: [], // { id, author: 'user'|'claude', text, words, prompt?, createdAt }
    chapters: [], // { id, title, startTurn }
    analysis: {
      style: "",
      genre: "",
      synopsis: "",
      quality: "",
      qualityScore: null,
      updatedAt: null,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function makeTurn(author, text, prompt) {
  const clean = String(text || "").replace(/\s+$/g, "");
  const turn = {
    id: newId(8),
    author: author === "claude" ? "claude" : "user",
    text: clean,
    words: countWords(clean),
    createdAt: Date.now(),
  };
  if (prompt) turn.prompt = String(prompt).trim();
  return turn;
}

export function totalWords(book) {
  return (book.turns || []).reduce((sum, t) => sum + (t.words || 0), 0);
}

// Whose move is it? The user writes first, then turns alternate.
export function isUsersMove(book) {
  if (book && book.mode === "guide") return true; // the director always moves next
  const turns = book.turns || [];
  if (turns.length === 0) return true;
  return turns[turns.length - 1].author === "claude";
}

// Apply a patch from the client (title/author/settings), ignoring anything
// the client shouldn't be able to set directly.
export function applyPatch(book, patch = {}) {
  const next = { ...book };
  if (typeof patch.title === "string") next.title = patch.title.trim() || "Untitled";
  if (typeof patch.author === "string") next.author = patch.author.trim() || "Anonymous";
  if (patch.settings && typeof patch.settings === "object") {
    next.settings = clampSettings({ ...book.settings, ...patch.settings });
  }
  if (patch.guide && typeof patch.guide === "object") {
    next.guide = clampGuide({ ...book.guide, ...patch.guide });
  }
  if (Array.isArray(patch.chapters)) {
    next.chapters = normalizeChapters(patch.chapters, (book.turns || []).length);
  }
  return next;
}

// Forking: keep turns[0..index-1] and drop everything from `index` onward.
// The book continues from that point — the discarded tail is gone.
export function truncateAt(book, index) {
  const turns = book.turns || [];
  const keep = Math.max(0, Math.min(index, turns.length));
  const chapters = normalizeChapters(
    (book.chapters || []).filter((c) => c.startTurn < keep),
    keep
  );
  return { ...book, turns: turns.slice(0, keep), chapters };
}

// Recent text for continuation context, capped so very long books stay cheap.
export function recentContext(book, maxWords = 3500) {
  const turns = book.turns || [];
  const picked = [];
  let acc = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    picked.unshift(turns[i]);
    acc += turns[i].words || 0;
    if (acc >= maxWords) break;
  }
  return picked.map((t) => t.text).join("\n\n");
}

// Continuation context split into the book's opening (founding voice + character
// introductions) and the recent verbatim window. The opening is only included
// when it falls outside the recent window, so short books aren't duplicated.
export function continuationParts(book, { recentWords = 3500, openingWords = 550 } = {}) {
  const turns = book.turns || [];
  if (!turns.length) return { opening: "", recent: "" };
  const picked = [];
  let acc = 0;
  let startIdx = turns.length - 1;
  for (let i = turns.length - 1; i >= 0; i--) {
    picked.unshift(turns[i]);
    acc += turns[i].words || 0;
    startIdx = i;
    if (acc >= recentWords) break;
  }
  const recent = picked.map((t) => t.text).join("\n\n");
  let opening = "";
  if (startIdx > 0) {
    const words = String(turns[0].text).split(/\s+/);
    opening =
      words.length > openingWords ? words.slice(0, openingWords).join(" ") + " …" : turns[0].text;
  }
  return { opening, recent };
}

// The entire manuscript, in order — used by "send the whole book" mode.
export function fullManuscript(book) {
  return (book.turns || []).map((t) => t.text).join("\n\n");
}

// Above this many words, even full-context mode falls back to the layered
// context so a very long book can't blow the model's context window.
export const FULL_CONTEXT_WORD_CAP = 90000;

// Full manuscript text (capped) for the analysis pass.
export function manuscriptText(book, maxWords = 12000) {
  const turns = book.turns || [];
  const text = turns.map((t) => t.text).join("\n\n");
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  // Keep the opening and the most recent material — that's what defines voice + arc.
  const head = words.slice(0, 1500).join(" ");
  const tail = words.slice(words.length - (maxWords - 1500)).join(" ");
  return `${head}\n\n[...middle of the manuscript omitted for length...]\n\n${tail}`;
}
