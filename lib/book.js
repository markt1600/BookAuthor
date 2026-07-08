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

// The book's design is fixed — cover, page format, material, typeface, and ink
// are no longer user choices; every book uses these defaults.
export const DEFAULT_SETTINGS = {
  cover: "classic",
  format: "portrait",
  material: "paper",
  font: "serif",
  fontSize: 19, // px, on-screen reading size for the page surface
  inkColor: "", // "" = the material's default ink (black on paper)
  fullContext: false, // send the entire manuscript to the model each turn
  selfEdit: false, // run a second "polish" pass over each new AI section before committing it
  bestOfTwo: false, // draft each section twice from different angles; a judge keeps the more human take
  largePage: false, // desktop only: enlarge the page trim (same shape) to fit more words per page
};

// How much larger a "large page" is on each axis. The page keeps its format
// (aspect ratio); enlarging the trim while holding the font size means more
// words flow onto each page. Applies on desktop reading and to the PDF export.
export const LARGE_PAGE_SCALE = 1.3;

function clampSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  // Design is fixed to the defaults — override anything a client (or an older
  // book) may have stored for these fields.
  for (const key of ["cover", "format", "material", "font", "inkColor"]) {
    s[key] = DEFAULT_SETTINGS[key];
  }
  let size = Number(s.fontSize);
  if (!Number.isFinite(size)) size = DEFAULT_SETTINGS.fontSize;
  s.fontSize = Math.min(28, Math.max(14, Math.round(size)));
  s.fullContext = Boolean(s.fullContext);
  s.selfEdit = Boolean(s.selfEdit);
  s.bestOfTwo = Boolean(s.bestOfTwo);
  s.largePage = Boolean(s.largePage);
  return s;
}

// ---- Guide mode (the user directs, the AI writes all the prose) ----
export const GUIDE_CHOICES = {
  style: ["literary", "hemingway", "murakami", "burdett", "minimalist"],
  pov: ["first", "third_limited", "third_omniscient"],
  tense: ["past", "present"],
};

export const GUIDE_LABELS = {
  style: {
    literary: "Literary",
    hemingway: "Hemingway",
    murakami: "Murakami",
    burdett: "Burdett",
    minimalist: "Minimalist",
  },
  pov: { first: "First person", third_limited: "Third — limited", third_omniscient: "Third — omniscient" },
  tense: { past: "Past tense", present: "Present tense" },
  intensity: ["None", "Mild", "Moderate", "Strong"],
};

// Picking one of the author styles presets the perspective and content register
// to reflect how that author typically writes. These are sensible starting
// points the user can override; only the named styles carry a profile.
export const STYLE_PROFILE = {
  hemingway: { pov: "first", tense: "past", adult: true, violence: 2, sexual: 1, language: 1 },
  murakami: { pov: "first", tense: "past", adult: true, violence: 1, sexual: 2, language: 1 },
  burdett: { pov: "first", tense: "present", adult: true, violence: 3, sexual: 2, language: 2 },
};

// Return a guide with the chosen style applied — plus that style's profile
// (perspective + maturity) when it has one. Non-profiled styles change only the
// style, leaving the user's other choices intact.
export function applyStyleProfile(guide, style) {
  const p = STYLE_PROFILE[style];
  return p ? { ...guide, style, ...p } : { ...guide, style };
}

export const DEFAULT_GUIDE = {
  style: "literary",
  pov: "third_limited",
  tense: "past",
  latitude: "balanced", // fixed — no longer user-configurable; always "balanced"
  sectionWords: 500, // 150..800 — length of each AI-written section
  adult: false,
  violence: 0, // 0..3
  sexual: 0,
  language: 0,
  erotica: false, // adult + explicitness at max → strong lean toward the erotica genre
};

export function clampGuide(input = {}) {
  const g = { ...DEFAULT_GUIDE, ...(input || {}) };
  for (const k of ["style", "pov", "tense"]) {
    if (!GUIDE_CHOICES[k].includes(g[k])) g[k] = DEFAULT_GUIDE[k];
  }
  g.latitude = "balanced"; // fixed — ignore any persisted/incoming value
  g.adult = Boolean(g.adult);
  let sw = Number(g.sectionWords);
  if (!Number.isFinite(sw)) sw = 500;
  g.sectionWords = Math.min(800, Math.max(150, Math.round(sw)));
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
    chapters: normalizeChapters([{ title: "", startTurn: 0 }], 0), // start on Chapter 1
    arc: [], // up to 3 heading goals: { id, text, pace: 'eventually'|'gradually'|'soon' }
    bible: "", // author-pinned canon: facts the AI must never contradict (editable in the notes)
    voiceSample: "", // optional sample passage whose voice/texture the AI should match
    characters: [], // author-confirmed cast sheet: { id, name, role, voice, notes }
    scoreHistory: [], // { at, score, words, sections } — appended on each analysis refresh
    ended: false, // author has marked the book finished (reversible); appends "The End"
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

// Split prose into display segments, honoring block quotes at the *line* level:
// a run of consecutive lines that each begin with ">" becomes one quote segment
// (marker stripped); other lines group into normal segments. Paragraph breaks
// (blank lines) always start a new segment. Returns [{ text, quote }].
export function segmentQuotes(text) {
  const segs = [];
  for (const para of String(text || "").split(/\n{2,}/)) {
    if (!para.length) continue;
    let cur = null;
    for (const line of para.split("\n")) {
      const q = /^[ \t]*>/.test(line);
      const t = q ? line.replace(/^[ \t]*>[ \t]?/, "") : line;
      if (cur && cur.quote === q) cur.lines.push(t);
      else {
        cur = { quote: q, lines: [t] };
        segs.push(cur);
      }
    }
  }
  return segs.map((s) => ({ text: s.lines.join("\n"), quote: s.quote })).filter((s) => s.text.length);
}

// Strip server-only fields and expose a `protected` flag before sending a book
// to the client. The password hash must never reach the browser (the unlock
// cookie is derived from it).
export function publicBook(book) {
  if (!book) return book;
  // Strip the password hash and the revision scratch fields (which can be large
  // and are server-only) before sending a book to the client.
  const { passwordHash, revisionText, revisionChunks, ...rest } = book;
  return { ...rest, protected: Boolean(passwordHash) };
}

// Partition a book's turns into contiguous chunks of at most ~maxWords, breaking
// preferentially at chapter starts. Used to rewrite a long book a piece at a time.
export function reviseChunks(book, maxWords = 3500) {
  const turns = book.turns || [];
  const chapterStart = new Set((book.chapters || []).map((c) => c.startTurn));
  const chunks = [];
  let start = 0;
  let words = 0;
  for (let i = 0; i < turns.length; i++) {
    const w = turns[i].words || countWords(turns[i].text);
    if (
      i > start &&
      (words + w > maxWords || (chapterStart.has(i) && words >= maxWords * 0.6))
    ) {
      chunks.push({ start, end: i });
      start = i;
      words = 0;
    }
    words += w;
  }
  if (start < turns.length) chunks.push({ start, end: turns.length });
  return chunks.length ? chunks : [{ start: 0, end: turns.length }];
}

// The source text for turns [start, end), with `## Chapter` markers for any
// chapter that begins within the range (chapter 1 at turn 0 stays implicit).
export function chunkSourceText(book, start, end) {
  const title = {};
  for (const c of book.chapters || []) title[c.startTurn] = c.title || "";
  const parts = [];
  for (let i = start; i < end; i++) {
    if (i !== 0 && Object.prototype.hasOwnProperty.call(title, i)) {
      parts.push(`## Chapter${title[i] ? `: ${title[i]}` : ""}`);
    }
    parts.push(book.turns[i].text);
  }
  return parts.join("\n\n");
}

// Apply a patch from the client (title/author/settings), ignoring anything
// the client shouldn't be able to set directly.
export const ARC_PACES = ["eventually", "gradually", "soon"];
export const MAX_ARC = 3;

// Approximate horizon (in AI-written sections) for each pace, used to instruct
// the model how fast to develop a heading and to track whether it's overdue.
export const ARC_HORIZON = {
  soon: { turns: 3, label: "about 2–3 sections" },
  gradually: { turns: 7, label: "about 6–8 sections" },
  eventually: { turns: 14, label: "a dozen-plus sections (the long arc)" },
};

// Count AI-written sections — the unit headings are paced in.
export function sectionCount(book) {
  return (book.turns || []).filter((t) => t && t.author === "claude").length;
}

// Normalize the heading goals: at most 3, trimmed text, valid pace, stable id.
export function sanitizeArc(arc) {
  if (!Array.isArray(arc)) return [];
  return arc
    .filter((h) => h && typeof h.text === "string" && h.text.trim())
    .slice(0, MAX_ARC)
    .map((h) => ({
      id: typeof h.id === "string" && h.id ? h.id : newId(),
      text: h.text.trim().slice(0, 400),
      pace: ARC_PACES.includes(h.pace) ? h.pace : "gradually",
    }));
}

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
  if (Array.isArray(patch.arc)) {
    // Preserve each heading's "born" section index by id; stamp new ones with the
    // current section count so the model can pace them by how long they've run.
    const born = sectionCount(book);
    const prev = new Map((book.arc || []).map((h) => [h.id, h]));
    next.arc = sanitizeArc(patch.arc).map((h) => {
      const old = prev.get(h.id);
      return { ...h, bornTurns: old && Number.isFinite(old.bornTurns) ? old.bornTurns : born };
    });
  }
  if (Array.isArray(patch.characters)) next.characters = sanitizeCharacters(patch.characters);
  if (typeof patch.bible === "string") next.bible = patch.bible.trim().slice(0, MAX_BIBLE);
  if (typeof patch.voiceSample === "string") {
    next.voiceSample = patch.voiceSample.trim().slice(0, MAX_VOICE_SAMPLE);
  }
  if (typeof patch.shared === "boolean") next.shared = patch.shared;
  if (typeof patch.ended === "boolean") next.ended = patch.ended;
  return next;
}

// Caps for the author-supplied prompt material. Generous, but bounded so a
// paste can't blow up every generation request.
export const MAX_BIBLE = 4000;
export const MAX_VOICE_SAMPLE = 3000;
export const MAX_CHARACTERS = 12;

// The cast sheet: author-confirmed character entries. Every field is clamped
// so the sheet stays a compact prompt block, not a dumping ground.
export function sanitizeCharacters(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c === "object" && typeof c.name === "string" && c.name.trim())
    .slice(0, MAX_CHARACTERS)
    .map((c) => ({
      id: typeof c.id === "string" && c.id ? c.id : newId(6),
      name: c.name.trim().slice(0, 80),
      role: typeof c.role === "string" ? c.role.trim().slice(0, 160) : "",
      voice: typeof c.voice === "string" ? c.voice.trim().slice(0, 200) : "",
      notes: typeof c.notes === "string" ? c.notes.trim().slice(0, 400) : "",
    }));
}

// The cast sheet rendered for a prompt (empty string when there's no cast).
export function castText(book) {
  const cast = Array.isArray(book.characters) ? book.characters : [];
  if (!cast.length) return "";
  return cast
    .map((c) => {
      const bits = [c.role, c.voice ? `Voice: ${c.voice}` : "", c.notes].filter(Boolean).join(" · ");
      return `${c.name}${bits ? ` — ${bits}` : ""}`;
    })
    .join("\n");
}

// Append today's quality score to the book's history (called after each
// analysis refresh). Skips duplicates from back-to-back refreshes that didn't
// change anything, and stays bounded.
const SCORE_HISTORY_CAP = 300;
export function recordScore(book) {
  const a = book.analysis;
  if (!a || a.qualityScore == null) return;
  if (!Array.isArray(book.scoreHistory)) book.scoreHistory = [];
  const h = book.scoreHistory;
  const entry = {
    at: Date.now(),
    score: a.qualityScore,
    words: totalWords(book),
    sections: sectionCount(book),
  };
  const last = h[h.length - 1];
  if (last && last.score === entry.score && last.words === entry.words) return;
  h.push(entry);
  while (h.length > SCORE_HISTORY_CAP) h.shift();
}

// The full prose of one chapter (by index into book.chapters), for the
// audiobook export. Includes a spoken chapter heading.
export function chapterText(book, chapterIndex) {
  const chapters = (book.chapters || []).slice();
  const turns = book.turns || [];
  if (chapterIndex < 0 || chapterIndex >= Math.max(1, chapters.length)) return "";
  const start = chapters[chapterIndex] ? chapters[chapterIndex].startTurn : 0;
  const end = chapters[chapterIndex + 1] ? chapters[chapterIndex + 1].startTurn : turns.length;
  const title = chapters[chapterIndex] && chapters[chapterIndex].title;
  const body = turns
    .slice(start, end)
    .map((t) => t.text)
    .join("\n\n");
  if (!body.trim()) return "";
  return `Chapter ${chapterIndex + 1}${title ? `. ${title}` : ""}.\n\n${body}`;
}

// A one-line factual statement of where the writing currently stands — which
// chapter, how deep into it, and the manuscript total — so the model can pace
// scene vs. summary and chapter-ending cadence. Empty for a blank book.
export function positionLine(book) {
  const turns = book.turns || [];
  if (!turns.length) return "";
  const chapters = (book.chapters || []).filter((c) => c.startTurn < turns.length);
  const chapterCount = Math.max(1, chapters.length);
  let current = 0; // index into chapters
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].startTurn <= turns.length - 1) current = i;
  }
  const startTurn = chapters[current] ? chapters[current].startTurn : 0;
  let chapterWords = 0;
  for (let i = startTurn; i < turns.length; i++) chapterWords += turns[i].words || 0;
  const total = totalWords(book);
  const title = chapters[current] && chapters[current].title ? ` (“${chapters[current].title}”)` : "";
  return (
    `Position in the book: you are writing inside chapter ${current + 1} of ${chapterCount} so far${title}, ` +
    `about ${chapterWords} words into that chapter; the whole manuscript is about ${total} words.`
  );
}

// Retroactive chapter split: begin a new chapter at a paragraph INSIDE an
// existing passage. When the chosen paragraph isn't the passage's first, the
// turn is split in two at that boundary — the original turn keeps its id (so
// bookmarks and jumps stay valid) and the tail becomes a new turn; chapter
// indices past the split shift by one. Returns the new book, or a string error.
export function splitChapterAt(book, turnId, paraIndex, title = "") {
  const turns = (book.turns || []).slice();
  const idx = turns.findIndex((t) => t && t.id === turnId);
  if (idx < 0) return "That passage no longer exists.";
  const paras = String(turns[idx].text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const pi = Math.max(0, Math.min(Number(paraIndex) || 0, paras.length - 1));

  let chapters = (book.chapters || []).map((c) => ({ ...c }));
  let chapterTurn = idx;
  if (pi > 0) {
    const head = paras.slice(0, pi).join("\n\n");
    const tail = paras.slice(pi).join("\n\n");
    if (!head || !tail) return "Pick a paragraph inside the passage.";
    const orig = turns[idx];
    turns[idx] = { ...orig, text: head, words: countWords(head) };
    const second = { ...orig, id: newId(8), text: tail, words: countWords(tail) };
    delete second.prompt; // the direction stays with the half it produced
    turns.splice(idx + 1, 0, second);
    chapters = chapters.map((c) => (c.startTurn > idx ? { ...c, startTurn: c.startTurn + 1 } : c));
    chapterTurn = idx + 1;
  } else if (chapters.some((c) => c.startTurn === idx)) {
    return "A chapter already starts here.";
  }

  chapters.push({ startTurn: chapterTurn, title: String(title || "").trim().slice(0, 120) });
  return {
    ...book,
    turns,
    chapters: normalizeChapters(chapters, turns.length),
    updatedAt: Date.now(),
  };
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

// Build the full editable text with chapter markers in place, so a full-text
// edit can preserve (and let you move) chapter breaks. A marker is a line like
// "## Chapter" or "## Chapter: Title".
export function fullTextWithChapters(book) {
  const byStart = {};
  for (const c of book.chapters || []) byStart[c.startTurn] = c;
  const parts = [];
  (book.turns || []).forEach((t, i) => {
    const c = byStart[i];
    if (c) parts.push(`## Chapter${c.title ? `: ${c.title}` : ""}`);
    parts.push(t.text);
  });
  return parts.join("\n\n");
}

const CHAPTER_MARKER = /^[ \t]*##[ \t]+chapter\b[ \t]*[:.\-]?[ \t]*(.*)$/i;

// Replace the whole manuscript with a freely-edited full text. Chapter-marker
// lines split the text into segments; each non-empty segment becomes one neutral
// merged turn, and a marked segment starts a chapter at that turn. The result
// reads as one continuous voice in either mode (no user/AI attribution).
export function mergeFullText(book, fullText) {
  const lines = String(fullText || "").replace(/\r\n/g, "\n").split("\n");
  const segs = [];
  let cur = { isChapter: false, title: "", buf: [] };
  for (const line of lines) {
    const m = line.match(CHAPTER_MARKER);
    if (m) {
      segs.push(cur);
      cur = { isChapter: true, title: (m[1] || "").trim().slice(0, 120), buf: [] };
    } else {
      cur.buf.push(line);
    }
  }
  segs.push(cur);

  const turns = [];
  const chapters = [];
  for (const seg of segs) {
    const text = seg.buf
      .join("\n")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length)
      .join("\n\n");
    if (!text) continue; // skip empty segments (incl. a marker with no body)
    const idx = turns.length;
    turns.push({
      id: newId(8),
      author: "claude",
      merged: true,
      text,
      words: countWords(text),
      createdAt: Date.now(),
    });
    if (seg.isChapter) chapters.push({ title: seg.title, startTurn: idx });
  }

  // A book always opens on Chapter 1. If the edited text has prose before the
  // first chapter marker (or no leading marker at all), anchor an implicit
  // chapter at the very start so a marker inserted mid-text becomes Chapter 2.
  if (turns.length && !chapters.some((c) => c.startTurn === 0)) {
    chapters.unshift({ title: "", startTurn: 0 });
  }

  return { ...book, turns, chapters: normalizeChapters(chapters, turns.length), updatedAt: Date.now() };
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
