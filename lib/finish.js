// Finish the book — the autopilot that writes every remaining chapter.
//
// The author asks for a plan: the outline is redrawn to run all the way to the
// last chapter (an "endgame" outline — see reviseOutline), which they can read
// and edit like any outline. Then the run writes it, one section per request
// (so it works inside a serverless time limit and can be stopped between any
// two sections):
//
//   1. the chapter about to be written is broken into section directions —
//      the same kind of instruction the author would type (planChapter);
//   2. each direction goes through the NORMAL section pipeline: the editor's
//      desk plans the beats and rules on the notes, the writer drafts, the
//      optional second take and polish run, the notes are refreshed;
//   3. when a chapter's last section lands, the chapter is closed at once —
//      summarised, cold-read, audited against the brief and the outline — the
//      remaining outline is redrawn from what it actually did, and only then
//      is the next chapter broken down;
//   4. the final chapter's last section ends the book and runs the final review.
//
// Nothing here talks to a model directly: prompts are in claude.js, the model
// and transport in providers.js.
import {
  chapterDigest,
  continuationParts,
  currentChapterNum,
  castText,
  finishOutlook,
  latestAudit,
  makeTurn,
  normalizeChapters,
  sectionCount,
  totalWords,
} from "@/lib/book";
import { guideStory, planChapter, planSection } from "@/lib/claude";
import {
  authorContext,
  finalReview,
  lensForSection,
  plannerLens,
  produceSection,
  redrawOutline,
  refreshAnalysis,
  refreshChapterNotes,
  withContext,
} from "@/lib/generate";
import {
  auditBlock,
  briefBlock,
  chapterWordBudget,
  fallbackDirections,
  nextFinishTarget,
  outlineEntryFor,
  outlineLastNum,
  sanitizeFinish,
  sectionPlacement,
  sectionRecap,
  sectionsForChapter,
} from "@/lib/storyplan";

// An error whose message is meant for the author as written.
export class FinishError extends Error {}

export function canFinish(book) {
  if (!book) return "Book not found";
  if (book.mode !== "guide") return "Finish the book is available for books you direct (guide mode).";
  if (book.ended) return "This book is already marked as ended — reopen it to write more.";
  return "";
}

// The book as it will stand the moment the NEXT chapter opens: the chapter now
// being written counts as closed (so it can be summarised and audited, and its
// notes reach the planner) and an empty chapter follows it. A view for reading
// — never saved.
export function nextChapterView(book) {
  const turns = book.turns || [];
  if (!turns.length) return book;
  const marks = (book.chapters || []).filter((c) => c && c.startTurn < turns.length);
  const chapters = marks.some((c) => c.startTurn === 0) ? marks : [{ id: "c0", title: "", startTurn: 0 }, ...marks];
  return {
    ...book,
    turns: [...turns, { id: "__next", author: "user", text: "", words: 0 }],
    chapters: [...chapters, { id: "__next", title: "", startTurn: turns.length }],
  };
}

// Copy what a refresh on a view produced back onto the real book.
function adopt(book, view) {
  if (view === book) return;
  book.analysis = view.analysis;
  book.scoreHistory = view.scoreHistory;
  if (view.chapterNotes) {
    const { __next, ...notes } = view.chapterNotes;
    book.chapterNotes = notes;
  }
  if (view.outline) book.outline = view.outline;
  if (view.brief && !book.brief) book.brief = view.brief;
}

// Where the next section goes: { num, opens, reuse, entry, final }.
function resolveTarget(book, finish) {
  const hasText = (book.turns || []).length > 0;
  const look = finishOutlook(book);
  let target = nextFinishTarget({
    finish,
    currentNum: look.cur,
    hasText,
    chapterWords: look.chapterWords,
    budget: look.budget,
    sectionWords: look.sectionWords,
    entrySummary: (num) => (outlineEntryFor(book.outline, num) || {}).summary || "",
  });
  // The plan may begin at the next chapter (the one in progress was judged
  // complete when it was drawn): follow the plan rather than the arithmetic.
  if (!target.reuse && !target.opens && hasText && !outlineEntryFor(book.outline, target.num) && outlineEntryFor(book.outline, look.cur + 1)) {
    target = { num: look.cur + 1, opens: true, reuse: false };
  }
  const last = outlineLastNum(book.outline);
  const entry = outlineEntryFor(book.outline, target.num);
  return { ...target, entry, last, final: Boolean(last) && target.num === last };
}

// Break the target chapter into section directions (model first, plain split
// of the outline entry if that fails). `view` is the book as the planner should
// see it — the next-chapter view when the chapter is about to open.
async function breakdown(book, view, target) {
  const look = finishOutlook(view);
  const written = target.opens ? 0 : look.chapterWords;
  const count = Math.max(1, sectionsForChapter(look.budget, look.sectionWords, written));
  const a = view.analysis || {};
  let directions = null;
  try {
    directions = await planChapter({
      title: book.title,
      num: target.num,
      entry: target.entry,
      through: (book.outline && book.outline.through) || "",
      next: outlineEntryFor(book.outline, target.num + 1),
      brief: briefBlock(book.brief, totalWords(book)),
      digest: chapterDigest(view),
      audit: auditBlock(latestAudit(view)),
      synopsis: a.synopsis,
      holes: a.holes,
      ledger: a.ledger,
      arc: book.arc,
      sections: sectionCount(book),
      bible: book.bible,
      cast: castText(book),
      recent: continuationParts(book, { recentWords: 1200 }).recent,
      count,
      writtenWords: written,
      sectionWords: look.sectionWords,
      final: target.final,
      lastNum: target.last,
    });
  } catch (err) {
    console.error("chapter breakdown failed:", err && err.message ? err.message : err);
  }
  if (!directions) directions = fallbackDirections(target.entry, count, { final: target.final, resumed: written > 0 });
  return {
    num: target.num,
    directions,
    done: 0,
    opens: target.opens,
    final: target.final,
    entry: (target.entry && target.entry.summary) || "",
  };
}

/**
 * Draw up the plan to the end: redraw the outline so it covers every remaining
 * chapter, and break down the first chapter of the run. Mutates the book
 * (outline, finish, and — when the chapter in progress is already complete —
 * its chapter notes). Throws FinishError with a message for the author.
 */
export async function planFinish(book) {
  const why = canFinish(book);
  if (why) throw new FinishError(why);
  const hasText = (book.turns || []).length > 0;
  if (!hasText && !briefBlock(book.brief)) {
    throw new FinishError("Write an opening or confirm a brief first — there's nothing to plan an ending from yet.");
  }
  // Has the chapter in progress already had its room? Judged against the
  // book's own average chapter (there is no plan to share a target over yet).
  const look = finishOutlook(book);
  const usual = chapterWordBudget({ avgChapterWords: look.avgChapterWords, sectionWords: look.sectionWords });
  const closing = hasText && sectionsForChapter(usual, look.sectionWords, look.chapterWords) === 0;
  const view = closing ? nextChapterView(book) : book;
  if (closing) await refreshChapterNotes(view); // summary, cold read and audit of the chapter being left
  const drawn = await redrawOutline(view, { toEnd: true, fresh: true });
  if (!drawn || !outlineLastNum(view.outline)) {
    throw new FinishError("The model didn't return a plan that reaches the end of the book — try again.");
  }
  adopt(book, view);
  book.outline = view.outline;
  const finish = sanitizeFinish({ status: "planned", plannedAt: Date.now(), fromChapter: look.cur, fromWords: look.totalWords });
  const target = resolveTarget(book, finish);
  if (!target.entry) throw new FinishError("Couldn't draw up a plan to the end — try again.");
  finish.chapter = await breakdown(book, target.opens ? nextChapterView(book) : book, target);
  book.finish = finish;
  return book;
}

// Drop the plan: the outline goes back to being a short rolling one.
export function cancelFinish(book) {
  book.finish = null;
  if (book.outline && book.outline.toEnd) {
    const { toEnd, ...rest } = book.outline;
    book.outline = { ...rest, rev: (rest.rev || 0) + 1, updatedAt: Date.now() };
  }
  return book;
}

/**
 * Write the next section of the run and commit it to `book` (not saved here).
 * Emits the usual stream events through `send`. Returns
 * { section, chapterDone, final } — what the caller needs for the follow-up.
 */
export async function writeFinishSection(book, { send, priorAnalysis, persist }) {
  const why = canFinish(book);
  if (why) throw new FinishError(why);
  const finish = sanitizeFinish(book.finish);
  if (!finish || !outlineLastNum(book.outline)) {
    throw new FinishError("There is no plan to the end yet — plan the rest of the book first.");
  }
  const target = resolveTarget(book, finish);
  if (!target.entry) {
    throw new FinishError(
      target.last && target.num > target.last
        ? "The plan has been written through its last chapter. Mark the book ended, or replan to go on."
        : `The plan has nothing for chapter ${target.num} — replan the rest of the book.`
    );
  }
  const view = target.opens ? nextChapterView(book) : book;
  if (!target.reuse) {
    send({ t: "plan" });
    finish.chapter = await breakdown(book, view, target);
    book.finish = finish;
    if (persist) await persist(); // keep the breakdown even if the draft fails
  }
  const ch = finish.chapter;
  const idx = ch.done;
  const total = ch.directions.length;
  const direction = ch.directions[idx];
  const closes = idx === total - 1;
  // The writer and planner are told where in the chapter this section sits,
  // what the chapter has already put on the page and what is held for later —
  // so a section neither re-stages the last one nor runs ahead of the next.
  const landed = idx > 0 ? (book.turns || []).slice(-idx).map(sectionRecap) : [];
  const place = sectionPlacement({ num: ch.num, directions: ch.directions, done: idx, final: ch.final, landed });
  const prompt = `${direction}\n\n${place}`;

  const ctx = authorContext(view);
  const targetWords = (book.guide && book.guide.sectionWords) || 500;
  const meta = {};
  const prose = await produceSection({
    book,
    priorAnalysis,
    send,
    meta,
    direction,
    makePlan: () =>
      planSection({
        title: book.title,
        mode: "guide",
        guide: book.guide,
        prompt,
        memory: priorAnalysis,
        recent: withContext(book, {}).recent || "",
        arc: book.arc,
        sections: sectionCount(book),
        targetWords,
        ...ctx,
        ...plannerLens(book, { direction }),
      }),
    makeDraft: (onDelta, variant, plan) =>
      guideStory(
        withContext(book, {
          title: book.title,
          author: book.author,
          guide: book.guide,
          prompt,
          memory: priorAnalysis,
          arc: book.arc,
          sections: sectionCount(book),
          targetWords,
          ...ctx,
          variant,
          plan,
          lens: lensForSection(book, { direction, plan, isLast: closes && ch.final }),
          onDelta,
        })
      ),
  });

  const section = makeTurn("claude", prose, direction);
  if (meta.plan) section.plan = meta.plan;
  section.auto = true; // written by the finish-the-book run
  const hadText = (book.turns || []).length > 0;
  book.turns = [...(book.turns || []), section];
  if (target.opens && hadText) {
    const marks = book.chapters || [];
    const base = marks.some((c) => c && c.startTurn === 0) ? marks : [{ title: "", startTurn: 0 }, ...marks];
    book.chapters = normalizeChapters(
      [...base, { startTurn: book.turns.length - 1, title: (target.entry.title || "").slice(0, 120) }],
      book.turns.length
    );
  }
  ch.done = idx + 1;
  ch.opens = false;
  finish.sections += 1;
  finish.status = "running";
  if (!finish.startedAt) finish.startedAt = Date.now();
  const chapterDone = ch.done >= total;
  const final = chapterDone && ch.final;
  if (final) {
    finish.status = "done";
    book.ended = true;
  }
  book.finish = finish;
  return { section, chapterDone, final };
}

/**
 * The follow-up to a written section — best-effort, never throws:
 *   - the book's last section: the final review of the whole manuscript;
 *   - a chapter's last section: close the chapter now (notes + audit), let the
 *     outline be redrawn from what it did, then break down the next chapter;
 *   - any other section: the normal notes refresh.
 */
export async function afterFinishSection(book, priorAnalysis, { chapterDone, final }) {
  try {
    if (final) {
      await finalReview(book);
      return;
    }
    if (!chapterDone) {
      await refreshAnalysis(book, priorAnalysis);
      return;
    }
    const view = nextChapterView(book);
    await refreshAnalysis(view, priorAnalysis);
    adopt(book, view);
    const finish = sanitizeFinish(book.finish);
    const target = resolveTarget(book, finish);
    if (target.entry && !target.reuse) {
      finish.chapter = await breakdown(book, nextChapterView(book), target);
      book.finish = finish;
    }
  } catch (err) {
    console.error("finish follow-up failed:", err && err.message ? err.message : err);
  }
}
