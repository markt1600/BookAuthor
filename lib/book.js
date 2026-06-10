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
  font: ["serif", "sans", "mono", "storybook"],
};

export const DEFAULT_SETTINGS = {
  cover: "classic",
  format: "portrait",
  material: "paper",
  font: "serif",
  fontSize: 19, // px, on-screen reading size for the page surface
};

function clampSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  for (const key of ["cover", "format", "material", "font"]) {
    if (!CHOICES[key].includes(s[key])) s[key] = DEFAULT_SETTINGS[key];
  }
  let size = Number(s.fontSize);
  if (!Number.isFinite(size)) size = DEFAULT_SETTINGS.fontSize;
  s.fontSize = Math.min(28, Math.max(14, Math.round(size)));
  return s;
}

export function newBook({ title, author, settings } = {}) {
  const now = Date.now();
  return {
    id: newId(),
    title: (title || "").trim() || "Untitled",
    author: (author || "").trim() || "Anonymous",
    settings: clampSettings(settings),
    turns: [], // { id, author: 'user'|'claude', text, words, createdAt }
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

export function makeTurn(author, text) {
  const clean = String(text || "").replace(/\s+$/g, "");
  return {
    id: newId(8),
    author: author === "claude" ? "claude" : "user",
    text: clean,
    words: countWords(clean),
    createdAt: Date.now(),
  };
}

export function totalWords(book) {
  return (book.turns || []).reduce((sum, t) => sum + (t.words || 0), 0);
}

// Whose move is it? The user writes first, then turns alternate.
export function isUsersMove(book) {
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
  return next;
}

// Forking: keep turns[0..index-1] and drop everything from `index` onward.
// The book continues from that point — the discarded tail is gone.
export function truncateAt(book, index) {
  const turns = book.turns || [];
  const keep = Math.max(0, Math.min(index, turns.length));
  return { ...book, turns: turns.slice(0, keep) };
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
