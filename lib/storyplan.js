// Story planning — the book's stated aims, its rolling outline, the chapter
// audit, and the "editor's desk" that rationalises everything into a short
// ranked brief for the writer. Pure, dependency-free helpers (no model client,
// no app imports) so they are shared by the server and the client and can be
// unit-tested directly; the model calls that fill these shapes live in claude.js.
//
//   THE BRIEF     what the book is trying to be — premise, promise to the
//                 reader, the shape of the ending, themes, target length. The
//                 AI may propose one; only an author-CONFIRMED brief is ever
//                 used in a prompt.
//   THE OUTLINE   the next few chapters, revised each time a chapter closes.
//                 Entries the author edits are pinned and survive revision.
//   THE AUDIT     a deep read of each chapter as it closes: what it did, how
//                 it sits against the brief and the outline, and a verdict on
//                 every suspected plot hole (confirmed / repaired / dismissed).
//   THE DESK      the planner reads every note on the book and rules on what
//                 matters for the next section; the writer gets that ruling
//                 instead of the whole pile of notes.

const clip = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Split a newline-separated note into its lines, dropping an explicit "none".
export function noteLines(text, max = 99) {
  return String(text || "")
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•\-–*]+/, "").trim())
    .filter((l) => l && !/^(none|balanced|n\/a)\.?$/i.test(l))
    .slice(0, max);
}

// ---- The brief ---------------------------------------------------------------

export const BRIEF_FIELDS = [
  { key: "premise", label: "Premise", max: 600, hint: "Who wants what, what stands in the way, and why it matters." },
  { key: "promise", label: "Promise to the reader", max: 400, hint: "The experience this book owes its reader — the kind of story, the feeling, the questions it will answer." },
  { key: "ending", label: "Shape of the ending", max: 400, hint: "Where it is heading — not the plot beat, the shape: what is won, lost, or understood." },
  { key: "themes", label: "Themes", max: 300, hint: "What the book keeps circling." },
  { key: "avoid", label: "Not this book", max: 300, hint: "What it must not turn into." },
];
export const BRIEF_MIN_WORDS = 2000;
export const BRIEF_MAX_WORDS = 400000;

// Normalize a brief from any source (author form, model proposal, stored book).
// Returns null when nothing is filled in. `confirmed` marks author approval.
export function clampBrief(input, { confirmed } = {}) {
  if (!input || typeof input !== "object") return null;
  const b = {};
  for (const f of BRIEF_FIELDS) b[f.key] = clip(input[f.key], f.max);
  const tw = Number(String(input.targetWords == null ? "" : input.targetWords).replace(/[, ]/g, ""));
  b.targetWords = Number.isFinite(tw) && tw > 0 ? Math.min(BRIEF_MAX_WORDS, Math.max(BRIEF_MIN_WORDS, Math.round(tw))) : 0;
  if (!BRIEF_FIELDS.some((f) => b[f.key]) && !b.targetWords) return null;
  b.confirmed = confirmed != null ? Boolean(confirmed) : Boolean(input.confirmed);
  b.updatedAt = Date.now();
  return b;
}

// A brief the author has confirmed (the only kind that reaches a prompt).
export function briefConfirmed(brief) {
  return Boolean(brief && brief.confirmed && !brief.dismissed && (BRIEF_FIELDS.some((f) => brief[f.key]) || brief.targetWords));
}
// An AI proposal waiting for the author.
export function briefProposed(brief) {
  return Boolean(brief && !brief.confirmed && !brief.dismissed && BRIEF_FIELDS.some((f) => brief[f.key]));
}

// Where the manuscript stands against its planned length, as a plain sentence.
export function lengthPosition(brief, totalWords) {
  const target = brief && Number(brief.targetWords);
  const total = Number(totalWords) || 0;
  if (!target || !total) return "";
  const pct = Math.round((total / target) * 100);
  const where =
    pct < 20 ? "the opening movement" : pct < 45 ? "the first half" : pct < 60 ? "around the midpoint" : pct < 85 ? "the second half" : pct < 100 ? "the final stretch" : "past its planned length";
  return `The manuscript stands at about ${total.toLocaleString("en-US")} of a planned ${target.toLocaleString("en-US")} words (${pct}%) — ${where}.`;
}

// The brief as a prompt block. Empty unless the author has confirmed it.
export function briefBlock(brief, totalWords = 0) {
  if (!briefConfirmed(brief)) return "";
  const lines = BRIEF_FIELDS.filter((f) => brief[f.key]).map((f) => `${f.label}: ${brief[f.key]}`);
  const pos = lengthPosition(brief, totalWords);
  if (pos) lines.push(pos);
  else if (brief.targetWords) lines.push(`Target length: about ${brief.targetWords.toLocaleString("en-US")} words.`);
  return `The author's brief — the stated aims for this book (authoritative on what the book is trying to be):\n${lines.join("\n")}`;
}

// ---- The rolling outline -----------------------------------------------------

export const OUTLINE_MAX = 6;
// An outline drawn for "Finish the book" runs all the way to the last chapter
// (`toEnd`), so it may hold many more entries than the rolling one.
export const ENDGAME_MAX = 24;
// A fresh plan to the end is never just "the chapter in progress": it lays out
// at least this many chapters (the author can cut any they don't want).
export const ENDGAME_MIN = 3;
// Longest chapter overview kept on a plan-to-the-end entry (characters).
export const OVERVIEW_MAX = 1200;
const outlineCap = (toEnd) => (toEnd ? ENDGAME_MAX : OUTLINE_MAX);
const shortId = () => Math.random().toString(36).slice(2, 8);

function cleanEntries(list) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== "object") continue;
    const num = Math.round(Number(e.num));
    const summary = clip(e.summary, 360);
    if (!Number.isInteger(num) || num < 1 || num > 999 || !summary || seen.has(num)) continue;
    seen.add(num);
    // A plan to the end also carries a fuller overview of the chapter (the
    // outline line says what it turns; the overview says how it gets there).
    const detail = clip(e.detail, OVERVIEW_MAX);
    out.push({
      id: typeof e.id === "string" && e.id ? e.id.slice(0, 12) : shortId(),
      num,
      title: clip(e.title, 80),
      summary,
      ...(detail ? { detail } : {}),
      pinned: Boolean(e.pinned),
    });
  }
  return out.sort((a, b) => a.num - b.num);
}

// Normalize an outline from any source. Returns null when it has no entries.
export function sanitizeOutline(input) {
  if (!input || typeof input !== "object") return null;
  const toEnd = Boolean(input.toEnd);
  const chapters = cleanEntries(input.chapters).slice(0, outlineCap(toEnd));
  const through = clip(input.through, 400);
  if (!chapters.length && !through) return null;
  return {
    through,
    chapters,
    ...(toEnd && chapters.length ? { toEnd: true } : {}),
    forChapter: Math.max(1, Math.round(Number(input.forChapter)) || 1),
    rev: Math.max(0, Math.round(Number(input.rev)) || 0),
    updatedAt: Number(input.updatedAt) || Date.now(),
  };
}

// An outline saved by the AUTHOR: any entry they added or changed is pinned, so
// later revisions plan around it instead of overwriting it.
export function authorOutline(input, prev) {
  // Whether the outline runs to the end is the plan's property, not the form's.
  const next = sanitizeOutline({ ...input, toEnd: Boolean(prev && prev.toEnd) });
  if (!next) return null;
  const before = new Map(((prev && prev.chapters) || []).map((e) => [e.num, e]));
  next.chapters = next.chapters.map((e) => {
    const old = before.get(e.num);
    const changed = !old || old.title !== e.title || old.summary !== e.summary;
    // An overview written for the old line no longer describes the chapter.
    const { detail, ...bare } = e;
    return { ...(changed ? bare : e), pinned: e.pinned || changed };
  });
  next.forChapter = (prev && prev.forChapter) || next.forChapter;
  next.rev = ((prev && prev.rev) || 0) + 1;
  next.updatedAt = Date.now();
  return next;
}

// Fold a freshly generated outline into the existing one: chapters already
// written fall away, the author's pinned entries stand, the rest is replaced.
export function mergeOutline(generated, existing, currentNum, { toEnd } = {}) {
  const cur = Math.max(1, Math.round(Number(currentNum)) || 1);
  const endgame = toEnd != null ? Boolean(toEnd) : Boolean(existing && existing.toEnd);
  const gen = sanitizeOutline(generated ? { ...generated, toEnd: endgame } : generated) || { through: "", chapters: [] };
  // The author's entries stand as written; a pinned entry with no overview of
  // its own takes the one the model wrote to fit it.
  const drafted = new Map(gen.chapters.map((e) => [e.num, e]));
  const pinned = ((existing && existing.chapters) || [])
    .filter((e) => e.pinned && e.num >= cur)
    .map((e) => (endgame && !e.detail && drafted.get(e.num) && drafted.get(e.num).detail ? { ...e, detail: drafted.get(e.num).detail } : e));
  const taken = new Set(pinned.map((e) => e.num));
  const chapters = [...pinned, ...gen.chapters.filter((e) => e.num >= cur && !taken.has(e.num)).map((e) => ({ ...e, pinned: false }))]
    .sort((a, b) => a.num - b.num)
    .slice(0, outlineCap(endgame));
  if (!chapters.length && !gen.through) return existing || null;
  return {
    through: gen.through || (existing && existing.through) || "",
    chapters,
    ...(endgame && chapters.length ? { toEnd: true } : {}),
    forChapter: cur,
    rev: ((existing && existing.rev) || 0) + 1,
    updatedAt: Date.now(),
  };
}

// True when the outline was drawn up for an earlier chapter than the one now
// being written (or doesn't exist) — time to revise it.
export function outlineNeedsRevision(outline, currentNum) {
  if (!outline || !Array.isArray(outline.chapters) || !outline.chapters.length) return true;
  return (Number(outline.forChapter) || 0) < (Number(currentNum) || 1);
}

export function outlineEntryFor(outline, num) {
  return ((outline && outline.chapters) || []).find((e) => e.num === num) || null;
}

// The number of the book's LAST chapter — known only when the outline runs to
// the end (0 otherwise).
export function outlineLastNum(outline) {
  if (!outline || !outline.toEnd || !Array.isArray(outline.chapters) || !outline.chapters.length) return 0;
  return Math.max(...outline.chapters.map((e) => e.num));
}

// The outline as a prompt block, from the chapter now being written onward.
export function outlineBlock(outline, currentNum, { max = 4 } = {}) {
  if (!outline) return "";
  const cur = Math.max(1, Math.round(Number(currentNum)) || 1);
  const ahead = (outline.chapters || []).filter((e) => e.num >= cur).slice(0, max);
  if (!ahead.length && !outline.through) return "";
  const last = outlineLastNum(outline);
  const lines = [];
  if (outline.through) lines.push(`Through-line to the ending: ${outline.through}`);
  for (const e of ahead) {
    const fin = last && e.num === last ? ", the FINAL chapter" : "";
    const head = e.num === cur ? `THIS CHAPTER (ch ${e.num}${fin}${e.title ? ` — ${e.title}` : ""})` : `Then ch ${e.num}${fin}${e.title ? ` — ${e.title}` : ""}`;
    lines.push(`${head}: ${e.summary}${e.pinned ? " [set by the author]" : ""}`);
    if (e.num === cur && e.detail) lines.push(`  How this chapter is planned to go (a high-level sketch of the WHOLE chapter, not of one section — a section delivers only its own part and may invent beyond it): ${e.detail}`);
  }
  if (last && last >= cur) {
    const left = last - cur;
    lines.push(
      left === 0
        ? "The book ENDS with this chapter: nothing may be left for a later one."
        : `The book ends with chapter ${last} — ${left} more chapter${left > 1 ? "s" : ""} after this one. Nothing new may be opened that those chapters cannot close.`
    );
  }
  return `The rolling outline — where the next chapters are heading (a working plan, revised as the story moves; entries set by the author are fixed):\n${lines.join("\n")}`;
}

// ---- The chapter audit -------------------------------------------------------

const AIM_VERDICTS = ["ON COURSE", "DRIFTING", "OFF COURSE"];
const OUTLINE_VERDICTS = ["DELIVERED", "PARTLY", "DIVERGED"];
const HOLE_STATUS = ["confirmed", "repaired", "dismissed"];

// "DRIFTING — the feud has taken over" → { verdict, note }.
function verdictOf(text, allowed) {
  const t = clip(text, 400);
  if (!t) return { verdict: "", note: "" };
  const up = t.toUpperCase();
  const hit = [...allowed].sort((a, b) => b.length - a.length).find((v) => up.startsWith(v));
  if (!hit) return { verdict: "", note: t };
  return { verdict: hit, note: t.slice(hit.length).replace(/^[\s:—–\-,.]+/, "").trim() };
}

// Normalize the model's audit. `priorHoles` are the suspected-gap lines the
// audit was asked to rule on, in order (the model answers by 1-based number).
export function normalizeAudit(raw, priorHoles = []) {
  if (!raw || typeof raw !== "object") return null;
  const prior = Array.isArray(priorHoles) ? priorHoles : noteLines(priorHoles);
  const holes = [];
  const seen = new Set();
  for (const h of Array.isArray(raw.holes) ? raw.holes : []) {
    if (!h || typeof h !== "object") continue;
    const n = Math.round(Number(h.n));
    const status = String(h.status || "").toLowerCase().trim();
    if (!Number.isInteger(n) || n < 1 || n > prior.length || seen.has(n) || !HOLE_STATUS.includes(status)) continue;
    seen.add(n);
    holes.push({ n, line: prior[n - 1], status, note: clip(h.note, 240) });
  }
  const newHoles = (Array.isArray(raw.newHoles) ? raw.newHoles : [])
    .map((s) => clip(s, 220))
    .filter(Boolean)
    .slice(0, 3);
  const audit = {
    accomplished: clip(raw.accomplished, 420),
    aims: verdictOf(raw.aims, AIM_VERDICTS),
    outline: verdictOf(raw.outline, OUTLINE_VERDICTS),
    position: clip(raw.position, 320),
    carry: noteLines(raw.carry, 3).map((l) => l.slice(0, 220)).join("\n"),
    holes,
    newHoles,
    at: Date.now(),
  };
  if (!audit.accomplished && !audit.position && !audit.carry && !holes.length && !newHoles.length) return null;
  return audit;
}

// The open-gap list after the audit has ruled: repaired and dismissed gaps
// drop out, confirmed (and unexamined) ones stay, newly found ones are added.
export function reconcileHoles(priorHoles, audit, max = 6) {
  const prior = noteLines(priorHoles);
  if (!audit) return prior.join("\n");
  const ruled = new Map((audit.holes || []).map((h) => [h.line, h.status]));
  const keep = prior.filter((l) => !["repaired", "dismissed"].includes(ruled.get(l)));
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const have = new Set(keep.map(norm));
  for (const h of audit.newHoles || []) {
    if (!have.has(norm(h))) {
      keep.push(h);
      have.add(norm(h));
    }
  }
  return keep.slice(0, max).join("\n");
}

// Gaps the audit examined and threw out — the analyzer is told not to re-flag them.
export function dismissedHoles(audit) {
  return ((audit && audit.holes) || []).filter((h) => h.status === "dismissed").map((h) => h.line);
}

// The audit as a prompt block for the planner and the analyzer.
export function auditBlock(note) {
  const a = note && note.audit;
  if (!a) return "";
  const lines = [];
  if (a.accomplished) lines.push(`What it accomplished: ${a.accomplished}`);
  if (a.aims && a.aims.verdict) lines.push(`Against the author's brief: ${a.aims.verdict}${a.aims.note ? ` — ${a.aims.note}` : ""}`);
  if (a.outline && a.outline.verdict) lines.push(`Against the outline: ${a.outline.verdict}${a.outline.note ? ` — ${a.outline.note}` : ""}`);
  if (a.position) lines.push(`Where the book stands: ${a.position}`);
  if (a.carry) lines.push(`Consequences the next chapter must pick up:\n${a.carry}`);
  if (!lines.length) return "";
  return `Audit of chapter ${note.num}${note.title ? ` (“${note.title}”)` : ""} — a deep read made when it closed:\n${lines.join("\n")}`;
}

// ---- The editor's desk: a ranked brief for the writer -------------------------
// The planner ends its beat plan with a PRIORITIES block — its ruling on which
// of the book's many notes matter for this one section. splitPlan separates the
// beats from that ruling; the writer is then given the ruling INSTEAD of the raw
// notes it was distilled from.

export const MAX_PRIORITIES = 5;
const PRIORITY_KINDS = ["MUST", "AVOID", "KEEP"];

export function splitPlan(plan) {
  const lines = String(plan || "").split(/\r?\n/);
  const beats = [];
  const priorities = [];
  let scenes = "";
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    // Strip markdown emphasis around a label, but never underscores inside a
    // word — scene keys are snake_case.
    const bare = line.replace(/^[\s>*_#-]+/, "").replace(/\*+/g, "").replace(/_+(?=\s|:|$)/g, "");
    if (/^SCENES?\s*:/i.test(bare)) {
      scenes = bare;
      inBlock = false;
      continue;
    }
    const head = bare.match(/^PRIORITIES\s*:?\s*(.*)$/i);
    if (head) {
      inBlock = true;
      if (head[1].trim()) priorities.push(head[1].trim());
      continue;
    }
    if (inBlock) {
      if (!line) continue;
      const item = bare.replace(/^\(?\d+[.)]\s*/, "").trim();
      if (item) priorities.push(item);
      continue;
    }
    beats.push(raw);
  }
  return {
    beats: beats.join("\n").trim(),
    priorities: priorities.map((p) => p.slice(0, 280)).slice(0, MAX_PRIORITIES),
    scenes,
  };
}

// MUST / AVOID / KEEP — the kind a priority line opens with ("" if unlabelled).
export function priorityKind(line) {
  const up = String(line || "").toUpperCase();
  return PRIORITY_KINDS.find((k) => up.startsWith(k)) || "";
}

// The ruling as the writer sees it.
export function prioritiesBlock(priorities) {
  const list = (Array.isArray(priorities) ? priorities : []).filter(Boolean);
  if (!list.length) return "";
  return (
    "What matters most in THIS section, in order. The editor's desk has already weighed every note on the book — the author's aims, the outline, open logic gaps, planted setups, pacing, reader expectations — against this section; these are the ones that apply here. Where two pull against each other, the earlier line wins. Satisfy them through what happens and how it is told; never mention them in the prose:\n" +
    list.map((p, i) => `${i + 1}. ${p}`).join("\n")
  );
}

// ---- Finish the book: the autopilot's arithmetic ------------------------------
// "Finish the book" writes every remaining chapter of an outline that runs to
// the end. These helpers decide how much room each chapter gets and turn a
// chapter's outline entry into per-section directions. Pure: numbers in,
// numbers (or text) out — the model calls live in claude.js, the run in finish.js.

export const FINISH_SECTIONS_MIN = 2;
export const FINISH_SECTIONS_MAX = 8;
// A chapter this far through its budget counts as written: the run opens the next.
export const CHAPTER_DONE_AT = 0.85;

// Words one remaining chapter should run to: the brief's target shared out over
// the chapters left, else the book's own average chapter, else four sections.
// Always between 2 and 10 sections' worth, so one odd number can't warp a chapter.
export function chapterWordBudget({ targetWords = 0, totalWords = 0, chaptersLeft = 0, avgChapterWords = 0, sectionWords = 500 } = {}) {
  const sec = Math.max(100, Number(sectionWords) || 500);
  const left = Math.max(1, Math.round(Number(chaptersLeft)) || 1);
  const remaining = (Number(targetWords) || 0) - (Number(totalWords) || 0);
  let budget = Number(targetWords) > 0 && remaining > 0 ? remaining / left : Number(avgChapterWords) || sec * 4;
  budget = Math.min(sec * 10, Math.max(sec * FINISH_SECTIONS_MIN, budget));
  return Math.round(budget);
}

// Sections still to write in a chapter with `writtenWords` already on the page.
// 0 means the chapter has had its room and the next one should open.
export function sectionsForChapter(budget, sectionWords = 500, writtenWords = 0) {
  const sec = Math.max(100, Number(sectionWords) || 500);
  const b = Math.max(sec, Number(budget) || sec * 4);
  const written = Math.max(0, Number(writtenWords) || 0);
  if (written >= b * CHAPTER_DONE_AT) return 0;
  const n = Math.round((b - written) / sec);
  const min = written > 0 ? 1 : FINISH_SECTIONS_MIN;
  return Math.min(FINISH_SECTIONS_MAX, Math.max(min, n));
}

// How many chapters a fresh plan-to-the-end should aim for.
export function suggestedChaptersLeft({ targetWords = 0, totalWords = 0, avgChapterWords = 0, sectionWords = 500 } = {}) {
  const target = Number(targetWords) || 0;
  if (!target) return 0; // no target length: the story decides
  const sec = Number(sectionWords) || 500;
  // A chapter the run writes is 2-8 sections, so size against that — not
  // against a book whose text so far is one long unbroken "chapter".
  const per = Math.min(sec * FINISH_SECTIONS_MAX, Math.max(sec * FINISH_SECTIONS_MIN, Number(avgChapterWords) || sec * 4));
  const remaining = target - (Number(totalWords) || 0);
  return Math.min(ENDGAME_MAX, Math.max(ENDGAME_MIN, Math.round(remaining / per)));
}

// The model's breakdown of a chapter into section directions, cleaned: `count`
// usable lines or null (the caller then falls back to fallbackDirections).
export function cleanDirections(raw, count) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.sections) ? raw.sections : null;
  if (!list) return null;
  const out = list
    .map((d) => clip(typeof d === "string" ? d : d && typeof d === "object" ? d.direction || d.summary || "" : "", 600))
    .filter(Boolean);
  const want = Math.max(1, Math.round(Number(count)) || out.length);
  if (!out.length) return null;
  // One or two over is trimmed from the middle's end; any short of the count
  // stands as it is (a chapter told in fewer sections is still the chapter).
  return out.length > want ? [...out.slice(0, want - 1), out[out.length - 1]] : out;
}

// Directions when the model's breakdown is unavailable: the outline entry
// itself, with each section told which part of the chapter it carries.
export function fallbackDirections(entry, count, { final = false, resumed = false } = {}) {
  const n = Math.max(1, Math.round(Number(count)) || 1);
  const what = `${entry && entry.title ? `"${entry.title}" — ` : ""}${(entry && entry.summary) || "Carry the story forward from where it stands."}`;
  return Array.from({ length: n }, (_, i) => {
    const first = i === 0;
    const last = i === n - 1;
    const part =
      n === 1
        ? resumed
          ? "Bring this chapter to its close: deliver what the chapter plan still owes and end on its turn."
          : "Write this chapter whole: open it, deliver its turn, and end on it."
        : first
          ? resumed
            ? "Pick up exactly where the prose stops and drive toward the chapter's turn."
            : "Open the chapter: start in motion, from the consequences of the last one, and set its problem."
          : last
            ? "Close the chapter: deliver the turn it exists for and end on the changed situation."
            : "The middle of the chapter: complicate it — the obstacle pushes back and the cost rises.";
    const end =
      last && final
        ? " This is the LAST section of the book: resolve the central question, pay off what is still open, and end on a final image — no epilogue of loose summary."
        : "";
    // The stage comes first: it is this section's job. The chapter plan is
    // context — the same for every section, so it must not read as the task.
    return `${part}${end}\n(The chapter's plan, for context — this section carries only its own part of it, and may invent what it needs beyond it: ${what})`;
  });
}

// Normalize the stored run state. `chapter` is the breakdown of the chapter now
// being written: its directions, how many are done, and the outline summary it
// was made from (so an edited outline entry is noticed and re-planned).
const FINISH_STATUS = ["planned", "running", "done"];
export function sanitizeFinish(input) {
  if (!input || typeof input !== "object") return null;
  const status = FINISH_STATUS.includes(input.status) ? input.status : "planned";
  const out = {
    status,
    startedAt: Number(input.startedAt) || 0,
    plannedAt: Number(input.plannedAt) || Date.now(),
    fromChapter: Math.max(1, Math.round(Number(input.fromChapter)) || 1),
    fromWords: Math.max(0, Math.round(Number(input.fromWords)) || 0),
    sections: Math.max(0, Math.round(Number(input.sections)) || 0),
    chapter: null,
  };
  const c = input.chapter;
  if (c && typeof c === "object" && Array.isArray(c.directions)) {
    const directions = c.directions.map((d) => clip(d, 900)).filter(Boolean).slice(0, FINISH_SECTIONS_MAX);
    const num = Math.round(Number(c.num));
    if (directions.length && Number.isInteger(num) && num >= 1) {
      out.chapter = {
        num,
        directions,
        done: Math.min(directions.length, Math.max(0, Math.round(Number(c.done)) || 0)),
        opens: Boolean(c.opens),
        final: Boolean(c.final),
        entry: clip(c.entry, 400),
      };
    }
  }
  return out;
}

// Where the run goes next, from the stored state and where the manuscript
// actually stands (the author may have written, trimmed or re-chaptered by hand
// since the last step). Returns { num, opens, reuse }: the chapter to write in,
// whether the next section opens it, and whether the stored breakdown still fits.
export function nextFinishTarget({ finish, currentNum, hasText, chapterWords = 0, budget = 0, sectionWords = 500, entrySummary = () => "" }) {
  const cur = Math.max(1, Math.round(Number(currentNum)) || 1);
  const c = finish && finish.chapter;
  if (c && c.done < c.directions.length) {
    const fits = c.opens && c.done === 0 ? c.num === cur + (hasText ? 1 : 0) : c.num === cur;
    if (fits && c.entry === entrySummary(c.num)) return { num: c.num, opens: c.opens && c.done === 0 && hasText, reuse: true };
  }
  if (!hasText) return { num: 1, opens: false, reuse: false };
  // The stored chapter is finished, or the manuscript moved under it: decide
  // from the page. A chapter that has had its room is closed and the next opens.
  const finished = c && c.num === cur && c.done >= c.directions.length;
  if (finished || sectionsForChapter(budget, sectionWords, chapterWords) === 0) return { num: cur + 1, opens: true, reuse: false };
  return { num: cur, opens: false, reuse: false };
}

// The editor's criticism ("What's holding it back") as separate points, most
// serious first — the form the planners and the writer are given it in.
export function criticismLines(critique, max = 4) {
  return noteLines(critique, max).map((l) => l.slice(0, 600));
}

// The ledger lines still awaiting payoff.
export function openSetupLines(ledger, max = 8) {
  return noteLines(ledger).filter((l) => !/\bpaid\b|\bresolved\b|✓/i.test(l)).slice(0, max);
}

// What a written section left on the page, in a line: the change and the ending
// its beat plan named, else its direction. Used to tell later sections of the
// same chapter what is already done.
export function sectionRecap(turn) {
  const plan = String((turn && turn.plan) || "");
  const pick = (label) => {
    const m = plan.match(new RegExp(`^[\\s>*_#-]*${label}\\s*:\\s*(.+)$`, "im"));
    return m ? m[1].replace(/\*+/g, "").trim() : "";
  };
  const change = pick("CHANGE");
  const ending = pick("ENDING");
  const said = String((turn && turn.prompt) || "").split("\n")[0].trim();
  const parts = [said, change ? `it changed: ${change}` : "", ending ? `it ended on: ${ending}` : ""].filter(Boolean);
  return clip(parts.join(" — "), 420);
}

// The note appended to a section's direction during a finish-the-book run:
// where the section sits in its chapter, what the chapter has ALREADY put on
// the page (so nothing is staged twice), and what is reserved for later
// sections (so this one doesn't run ahead). `landed` holds a recap line for
// each section of the chapter already written, in order.
export function sectionPlacement({ num, directions, done = 0, final = false, landed = [], gaps = [], setups = [], concerns = [] } = {}) {
  const list = Array.isArray(directions) ? directions : [];
  const total = list.length;
  const idx = Math.max(0, Math.min(total - 1, Math.round(Number(done)) || 0));
  const closes = idx === total - 1;
  const first = (d) => clip(String(d || "").split("\n")[0], 240);
  const before = (Array.isArray(landed) ? landed : []).filter(Boolean).slice(-idx || undefined);
  const after = list.slice(idx + 1).map(first).filter(Boolean);
  const lines = [`(Autopilot — section ${idx + 1} of ${total} in chapter ${num}${final ? ", the final chapter of the book" : ""}.`];
  if (idx > 0 && before.length) {
    lines.push(
      "ALREADY ON THE PAGE in this chapter — finished. Do not re-stage, re-describe or re-explain any of it, and nobody re-notices, re-realises or re-argues what they already have:",
      ...before.map((r, i) => `  ${i + 1}. ${r}`)
    );
  }
  lines.push(
    idx > 0
      ? "THIS SECTION is the direction above and nothing before it. Start from the exact moment the prose stops — no reopening the scene, no re-establishing the place or the mood, no recap. Every beat must be something that has not happened yet."
      : "THIS SECTION is the direction above. The direction and the chapter plan are a high-level sketch: go beyond them — invent the concrete incident, obstacle and exchange the section needs, within the canon and the brief."
  );
  if (idx > 0) {
    lines.push(
      "The direction is a high-level sketch: go beyond it with NEW incident rather than circling what is written — a fresh obstacle, a turn in the exchange, a consequence landing — within the canon and the brief."
    );
  }
  lines.push(
    "ACTION FIRST: carry this section on what people do and say — movement, choices, confrontation, things found, taken, broken or said aloud. Keep inner monologue to a line or two at a time, and only where a decision turns on it; show what someone thinks or feels through what they do next, not through reflection. No stretch of remembering, weighing or summing-up, and no paragraph in which nothing outside a character's head changes."
  );
  if (after.length) {
    lines.push("STILL TO COME in later sections of this chapter — do NOT write them, reach them, or summarise toward them:", ...after.map((d, i) => `  ${idx + 2 + i}. ${d}`));
  }
  // What the book still has open, as it stands NOW (the notes are refreshed
  // after every section, so a gap an earlier section closed is gone from here).
  const openGaps = (Array.isArray(gaps) ? gaps : []).map((g) => clip(g, 220)).filter(Boolean).slice(0, 4);
  const openSetups = (Array.isArray(setups) ? setups : []).map((g) => clip(g, 220)).filter(Boolean).slice(0, 4);
  if (openGaps.length || openSetups.length) {
    lines.push(
      final
        ? "OPENINGS — still open in the book, and this is its last chapter. Whatever this section's events can close, close: through what someone does, says or finds — never by explanation. Anything left open must be left open on purpose and in plain sight."
        : "OPENINGS — still open in the book. Look at what actually happens in this section and the people in it: if it gives a natural chance to close one of these, or to move the plot a real step further than the direction asks, take it — through what someone does, says or finds, never by explanation or coincidence. Do not force one that does not fit, and leave alone anything the outline keeps for a later chapter.",
      ...openGaps.map((g) => `  logic gap: ${g}`),
      ...openSetups.map((g) => `  planted, awaiting payoff: ${g}`)
    );
  }
  // What the editor says is holding the book back, as it stands now.
  const held = (Array.isArray(concerns) ? concerns : []).map((g) => clip(g, 320)).filter(Boolean).slice(0, 3);
  if (held.length) {
    lines.push(
      final
        ? "HOLDING THE BOOK BACK — the editor's criticism as it stands, and this is the last chapter in which to answer it. Where this section's events can put one of these right, do it through what someone does, chooses or pays — never by explaining it, and never by mentioning the criticism:"
        : "HOLDING THE BOOK BACK — the editor's criticism as it stands. Where this section's events can put one of these right, do it through what someone does, chooses or pays — never by explaining it, and never by mentioning the criticism. One point answered properly beats all of them gestured at:",
      ...held.map((g) => `  - ${g}`)
    );
  }
  lines.push(
    closes && final
      ? "This is the LAST section of the book: end the book here, on a final image — resolved, not summarised.)"
      : closes
        ? "It closes the chapter: end on the chapter's changed situation, with something left for the next chapter to face.)"
        : "The chapter continues after it: do not wrap the chapter up; end where the next section can pick up.)"
  );
  return lines.join("\n");
}
