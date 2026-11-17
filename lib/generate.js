import {
  castText,
  chapterDigest,
  chapterSpans,
  closedChapterNotes,
  countWords,
  continuationParts,
  currentChapterNum,
  finishOutlook,
  fullManuscript,
  FULL_CONTEXT_WORD_CAP,
  latestAudit,
  latestColdRead,
  manuscriptText,
  positionLine,
  pruneChapterNotes,
  recordScore,
  reviewLean,
  sectionCount,
  staleChapters,
  textFingerprint,
  totalWords,
} from "@/lib/book";
import { providerErrorMessage } from "@/lib/providers";
import {
  analyzeStory,
  auditChapter,
  coldReadChapter,
  pickTake,
  reviseOutline,
  selfEditSection,
  suggestBrief,
  summarizeChapter,
} from "@/lib/claude";
import {
  auditBlock,
  briefBlock,
  briefConfirmed,
  dismissedHoles,
  lengthPosition,
  mergeOutline,
  noteLines,
  outlineBlock,
  outlineEntryFor,
  outlineLastNum,
  ENDGAME_MIN,
  outlineNeedsRevision,
  reconcileHoles,
  suggestedChaptersLeft,
} from "@/lib/storyplan";
import { lintProse, varietyBlock, STYLE_EXEMPLAR, SECOND_TAKE_NOTE } from "@/lib/craft";
import { textureNote } from "@/lib/maturity";
import lensData from "@/data/reader-lenses.json";
import { matchGenre, detectPhase, parseSceneTags, lensBlock, rubricBlock, sceneTagInstruction, sceneKinds } from "@/lib/readerlens";

// ---- Reader Lens wiring (opt-in per book via settings.readerLens) ----
// Genre-aware guidance distilled from thousands of real reader reviews, folded
// into the prompts as guidance — never rules. Off by default: when the switch
// is off every block below returns "" and the prompts are byte-identical to
// the previous method.
export function readerLensOn(book) {
  return Boolean(book && book.settings && book.settings.readerLens);
}
export function lensKeyFor(book) {
  if (!readerLensOn(book)) return "";
  const g = (book && book.guide) || {};
  return matchGenre(lensData, book.analysis && book.analysis.genre, {
    style: g.style,
    adult: g.adult,
    erotica: g.erotica,
    sexual: g.sexual,
  });
}
// The writer's guidance for the next section: situational first (where in the
// book, then the scene kinds the section's beat plan tagged), then the genre's
// general reward/punish/expectation/prose notes.
export function lensForSection(book, { direction = "", plan = "", isFirst = false, isLast = false } = {}) {
  const key = lensKeyFor(book);
  if (!key) return "";
  const phase = detectPhase({
    chapterNum: currentChapterNum(book),
    sections: sectionCount(book),
    direction,
    ended: Boolean(book.ended),
    isFirst,
    isLast,
  });
  return lensBlock(lensData, { genre: key, phase, scenes: parseSceneTags(plan, lensData, key) });
}
// The planner's share. The planner is the editor's desk — it reads everything
// so the writer doesn't have to — so it gets the whole lens: where-in-the-book
// guidance, the guidance for EVERY scene kind of this genre (it picks the ones
// the section is), and the general notes; plus one line telling it to end the
// plan with "SCENES: key, key" from this genre's own scene taxonomy.
export function plannerLens(book, { direction = "" } = {}) {
  const key = lensKeyFor(book);
  if (!key) return { lens: "", sceneInstruction: "" };
  const phase = detectPhase({
    chapterNum: currentChapterNum(book),
    sections: sectionCount(book),
    direction,
    ended: Boolean(book.ended),
  });
  return {
    lens: lensBlock(lensData, {
      genre: key,
      phase,
      scenes: sceneKinds(lensData, key).map((k) => k.key),
      maxChars: 4600,
    }),
    sceneInstruction: sceneTagInstruction(lensData, key),
  };
}
// The chunked revision's writer: phase from the chunk's position (first part
// gets opening guidance, last part ending), scenes from the shared plan.
export function revisionChunkLens(book, { plan = "", isFirst = false, isLast = false } = {}) {
  const key = lensKeyFor(book);
  if (!key) return "";
  const phase = detectPhase({ chapterNum: 1, sections: 1, isFirst, isLast });
  return lensBlock(lensData, { genre: key, phase, scenes: parseSceneTags(plan, lensData, key) });
}
// The critic's share: what readers of this genre reward and punish.
export function rubricFor(book) {
  const key = lensKeyFor(book);
  return key ? rubricBlock(lensData, key) : "";
}

// Attach the generation context: the whole book when the user opted in (and it
// fits the cap), otherwise the layered opening + most-recent window.
export function withContext(book, args) {
  const whole = fullManuscript(book);
  if (book.settings && book.settings.fullContext && countWords(whole) <= FULL_CONTEXT_WORD_CAP) {
    args.whole = whole;
  } else {
    const parts = continuationParts(book);
    args.opening = parts.opening;
    args.recent = parts.recent;
  }
  return args;
}

// The author-supplied prompt material every prose generation gets: the pinned
// canon, the voice sample (the author's own, or the built-in exemplar for the
// chosen guide style), where the writing stands, and the variety steering
// (section shape memory + this section's texture roll).
//
// It also carries the planning material — the author's brief, the rolling
// outline, the last chapter's audit, the freshest cold read — which only the
// PLANNER reads (the writers ignore those keys): the planner weighs them and
// hands the writer a ranked ruling instead. `opensChapter` is set when the
// section about to be written begins a new chapter, so "this chapter" in the
// outline means the one being opened, not the one being left.
export function authorContext(book, { opensChapter = false } = {}) {
  const own = (book.voiceSample || "").trim();
  const chapterNum = currentChapterNum(book) + (opensChapter && (book.turns || []).length ? 1 : 0);
  const exemplar =
    book.mode === "guide" ? STYLE_EXEMPLAR[(book.guide && book.guide.style) || ""] || "" : "";
  return {
    bible: (book.bible || "").trim(),
    cast: castText(book),
    voiceSample: own || exemplar,
    position: positionLine(book),
    variety: varietyBlock(book, textureNote(book)),
    digest: chapterDigest(book),
    brief: briefBlock(book.brief, totalWords(book)),
    outline: book.ended ? "" : outlineBlock(book.outline, chapterNum),
    audit: auditBlock(latestAudit(book)),
    coldRead: latestColdRead(book),
    // The last two sections' beat plans, so the planner doesn't repeat a shape.
    priorPlans: (book.turns || [])
      .filter((t) => t && t.author === "claude" && t.plan)
      .slice(-2)
      .map((t) => t.plan),
  };
}

// The full section pipeline: optionally sketch a private beat plan first —
// then draft; optionally draft a SECOND take from a different angle and let a
// judge keep the more human one; then optionally run the polish pass, fed with
// the mechanical tell-linter's findings. Emits "plan" / "take" / "polish"
// stream events so the client can label each phase. Every extra step degrades
// safely: a failed plan drafts unplanned; a failed second take or judge keeps
// the first draft; a failed polish keeps the unpolished one. `meta.plan`
// receives the plan so the caller can store it on the section.
export async function produceSection({ book, priorAnalysis, send, makeDraft, makePlan, meta, direction = "" }) {
  const onDelta = (d) => send({ t: "delta", d });
  const s = book.settings || {};

  let plan = "";
  if (s.planFirst !== false && typeof makePlan === "function") {
    try {
      send({ t: "plan" });
      plan = (await makePlan()) || "";
    } catch (err) {
      console.error("beat plan failed:", err && err.message ? err.message : err);
      plan = "";
    }
  }
  if (meta && typeof meta === "object") meta.plan = plan;

  let prose = await makeDraft(onDelta, "", plan);

  if (s.bestOfTwo) {
    let second = null;
    try {
      send({ t: "take" });
      second = await makeDraft(onDelta, SECOND_TAKE_NOTE, plan);
    } catch {}
    if (second) {
      try {
        if (
          (await pickTake({
            title: book.title,
            a: prose,
            b: second,
            adult: reviewLean(book).adult,
          })) === "B"
        )
          prose = second;
      } catch {
        // judge failed — keep the first take
      }
    }
  }

  if (s.selfEdit) {
    try {
      send({ t: "polish" });
      prose = await selfEditSection({
        title: book.title,
        mode: book.mode,
        guide: book.guide,
        draft: prose,
        memory: priorAnalysis,
        lint: lintProse(prose),
        lens: lensForSection(book, { direction, plan }),
        onDelta,
      });
    } catch {
      // polish failed — the raw draft stands
    }
  }

  return prose;
}

// The analyzer may flag headings it judges substantially achieved. We do NOT
// remove them — the author confirms with one tap. This resolves the analyzer's
// (order-based) arcDone into stable heading IDs the client can offer to retire,
// and clears the raw flag. Non-destructive: book.arc is never changed here.
export function resolveDoneSuggestions(book, analysis) {
  if (!analysis) return;
  const raw = analysis.arcDone;
  delete analysis.arcDone;
  if (!Array.isArray(book.arc) || !book.arc.length || !raw || /\bnone\b/i.test(raw)) {
    analysis.arcDoneIds = [];
    return;
  }
  const n = book.arc.length;
  const idx = [
    ...new Set(
      (String(raw).match(/\d+/g) || [])
        .map((x) => parseInt(x, 10) - 1)
        .filter((i) => i >= 0 && i < n)
    ),
  ];
  analysis.arcDoneIds = idx.map((i) => book.arc[i].id);
}

// Hierarchical memory: bring the per-chapter notes up to date. Every CLOSED
// chapter whose notes are missing or stale (its text changed) gets a summary
// and a cold read, in parallel; results are cached against the chapter text's
// fingerprint. Bounded per call so a full-text edit that invalidates every
// chapter catches up over a few refreshes instead of one enormous one. Never
// throws; a failed chapter simply stays stale and is retried next time.
//
// The chapter AUDIT rides along, but only for the most recently closed chapter:
// it is a deep read on the stronger model, and its findings (verified plot
// holes, where the book stands, what the next chapter must pick up) only matter
// at the story's leading edge. Switched off per book with settings.chapterAudit.
const CHAPTER_WORK_CAP = 4;
export function auditOn(book) {
  return !(book && book.settings && book.settings.chapterAudit === false);
}

async function runAudit(book, ch) {
  const a = book.analysis || {};
  const entry = outlineEntryFor(book.outline, ch.num);
  const spans = chapterSpans(book);
  try {
    return await auditChapter({
      title: book.title,
      num: ch.num,
      chapterTitle: ch.title,
      text: ch.text,
      prior: chapterDigest(book, ch.num),
      brief: briefBlock(book.brief),
      outlineEntry: entry ? `${entry.title ? `${entry.title} — ` : ""}${entry.summary}` : "",
      holes: noteLines(a.holes, 6),
      ledger: a.ledger,
      bible: book.bible,
      cast: castText(book),
      continuity: a.continuity,
      position: briefConfirmed(book.brief) ? lengthPosition(book.brief, totalWords(book)) : "",
      final: Boolean(book.ended) && spans.length > 0 && spans[spans.length - 1].id === ch.id,
    });
  } catch (err) {
    console.error("chapter audit failed:", err && err.message ? err.message : err);
    return null;
  }
}

export async function refreshChapterNotes(book) {
  try {
    pruneChapterNotes(book);
    const closed = chapterSpans(book).filter((ch) => ch.closed && ch.text.trim());
    const last = closed.length ? closed[closed.length - 1] : null;
    const wantsAudit = (ch) => auditOn(book) && last && ch.id === last.id;
    const audited = new Set();
    const stale = staleChapters(book).slice(0, CHAPTER_WORK_CAP);
    if (!book.chapterNotes) book.chapterNotes = {};
    const notes = book.chapterNotes;
    let changed = false;
    for (const ch of stale) {
      // The digest of the chapters before this one gives the summarizer names
      // and context (and is available for earlier chapters already done).
      const prior = chapterDigest(book, ch.num);
      if (wantsAudit(ch)) audited.add(ch.id);
      const [summary, cold, audit] = await Promise.all([
        summarizeChapter({ title: book.title, num: ch.num, chapterTitle: ch.title, text: ch.text, prior }).catch(
          (err) => {
            console.error("chapter summary failed:", err && err.message ? err.message : err);
            return "";
          }
        ),
        coldReadChapter({ num: ch.num, text: ch.text }).catch((err) => {
          console.error("cold read failed:", err && err.message ? err.message : err);
          return null;
        }),
        wantsAudit(ch) ? runAudit(book, ch) : Promise.resolve(null),
      ]);
      if (!summary && !cold) continue; // both failed — leave it stale for a retry
      changed = true;
      notes[ch.id] = {
        fp: textFingerprint(ch.text),
        num: ch.num,
        title: ch.title,
        words: countWords(ch.text),
        summary: summary || (notes[ch.id] && notes[ch.id].summary) || "",
        cold: cold || (notes[ch.id] && notes[ch.id].cold) || null,
        audit: audit || null,
        auditFails: wantsAudit(ch) && !audit ? 1 : 0,
        at: Date.now(),
      };
    }
    // The latest closed chapter may have current notes but no audit yet (a book
    // written before audits existed, or an audit that failed last time). Give
    // it one — with a bounded number of retries so a dead model can't loop.
    if (last && wantsAudit(last) && !audited.has(last.id)) {
      const n = notes[last.id];
      if (n && n.fp === textFingerprint(last.text) && !n.audit && (n.auditFails || 0) < 2) {
        const audit = await runAudit(book, last);
        if (audit) n.audit = audit;
        else n.auditFails = (n.auditFails || 0) + 1;
        changed = true;
      }
    }
    return changed;
  } catch (err) {
    console.error("chapter notes refresh failed:", err && err.message ? err.message : err);
    return false;
  }
}

// After a route re-reads the latest saved book (to avoid clobbering concurrent
// edits), copy across everything the analysis refresh produced.
export function carryNotes(latest, book) {
  latest.analysis = book.analysis;
  latest.scoreHistory = book.scoreHistory;
  latest.chapterNotes = book.chapterNotes;
  // A redrawn outline is carried only if the author didn't edit the outline
  // while the refresh ran (an edit bumps `rev` too — theirs wins). A proposed
  // brief is carried only if the book still has none.
  if (book.outline && (book.outline.rev || 0) > ((latest.outline && latest.outline.rev) || 0)) {
    latest.outline = book.outline;
  }
  if (book.brief && !latest.brief) latest.brief = book.brief;
  return latest;
}

// The stream event that delivers a finished notes refresh to the client.
export function notesEvent(book) {
  return {
    t: "analysis",
    analysis: book.analysis,
    chapterNotes: book.chapterNotes,
    outline: book.outline || null,
    brief: book.brief || null,
    finish: book.finish || null,
  };
}

// ---- The planning layer: brief proposal + rolling outline ---------------------

// Ask for a brief PROPOSAL from the story so far. Returns an unconfirmed brief
// (or null); nothing is saved here.
export async function proposeBrief(book) {
  const a = book.analysis || {};
  return suggestBrief({
    title: book.title,
    fullText: manuscriptText(book),
    digest: chapterDigest(book),
    synopsis: a.synopsis,
    genre: a.genre,
    arc: book.arc,
    mode: book.mode,
    totalWords: totalWords(book),
  });
}

// Redraw the rolling outline from where the story stands, keeping the author's
// pinned entries. Mutates book.outline; returns true if it changed.
//
// An outline that runs to the end (`toEnd` — drawn for "Finish the book") is
// redrawn as one: every remaining chapter, never past the last chapter already
// agreed. Pass { toEnd: true } to draw the first such plan, { toEnd: false } to
// go back to the short rolling outline.
export async function redrawOutline(book, { toEnd, fresh } = {}) {
  const cur = currentChapterNum(book);
  const a = book.analysis || {};
  const old = book.outline;
  const endgame = toEnd != null ? Boolean(toEnd) : Boolean(old && old.toEnd);
  // 0 on a first plan and on an explicit replan: the model sets the length.
  const ceiling = endgame && !fresh ? outlineLastNum(old) : 0;
  const look = endgame ? finishOutlook(book) : null;
  const pinned = ((old && old.chapters) || []).filter((e) => e.pinned && e.num >= cur);
  const previous = ((old && old.chapters) || [])
    .filter((e) => !endgame || e.num >= cur)
    .map((e) => `ch ${e.num}${e.title ? ` — ${e.title}` : ""}: ${e.summary}`)
    .join("\n");
  const draw = (shortfall) =>
    reviseOutline({
      shortfall,
        title: book.title,
        mode: book.mode,
        currentNum: cur,
        brief: briefBlock(book.brief, totalWords(book)),
        digest: chapterDigest(book),
        audit: auditBlock(latestAudit(book)),
        synopsis: a.synopsis,
        holes: a.holes,
        ledger: a.ledger,
        arc: book.arc,
        sections: sectionCount(book),
        pinned,
        previous: previous ? `${old.through ? `Through-line: ${old.through}\n` : ""}${previous}` : "",
        position: positionLine(book),
        recent: continuationParts(book, { recentWords: 1200 }).recent,
        endgame: endgame
          ? {
              lastNum: ceiling,
              chapters: ceiling
                ? 0
                : suggestedChaptersLeft({
                    targetWords: look.targetWords,
                    totalWords: Math.max(0, look.totalWords - look.chapterWords),
                    avgChapterWords: look.avgChapterWords,
                    sectionWords: look.sectionWords,
                  }),
            }
          : null,
    });
  // The chapters a draft covers (with the author's pinned ones), and whether
  // it is a whole plan: every chapter from the current one to its last, no gaps.
  const nums = (g) => new Set([...pinned, ...((g && g.chapters) || [])].filter((e) => e.num >= cur).map((e) => e.num));
  const whole = (g) => {
    const set = nums(g);
    if (set.size < (ceiling ? 1 : ENDGAME_MIN)) return false;
    for (let n = cur; n <= Math.max(...set); n++) if (!set.has(n)) return false;
    return true;
  };
  let generated = await draw(0);
  if (endgame && !ceiling) {
    // A fresh plan to the end has to lay out the rest of the book. A draft that
    // stops after a chapter or two gets one more try, then is refused.
    if (!whole(generated)) generated = await draw(Math.max(1, nums(generated).size));
    if (!whole(generated) || nums(generated).size < ENDGAME_MIN) return false;
  }
  if (endgame) {
    // A plan to the end must cover the chapter being written, and may not run
    // past the agreed last chapter. A draft that fails either is discarded and
    // the plan in force stands.
    if (!generated || !generated.chapters.some((e) => e.num === cur)) return false;
    if (ceiling) generated.chapters = generated.chapters.filter((e) => e.num <= ceiling);
    if (!whole(generated)) return false; // a plan that skips a chapter cannot be written from
  }
  const merged = mergeOutline(generated, old, cur, { toEnd: endgame });
  if (!merged) return false;
  book.outline = merged;
  return true;
}

// After the notes refresh: once a chapter has closed, propose a brief if the
// book has none, and redraw the outline if the writing has moved into a new
// chapter since it was drawn. Best-effort; never throws.
export async function refreshPlanning(book) {
  if (!auditOn(book) || book.ended || !(book.turns || []).length) return;
  if (!closedChapterNotes(book).length) return;
  const jobs = [];
  if (!book.brief) {
    jobs.push(
      proposeBrief(book)
        .then((b) => {
          if (b) book.brief = b;
        })
        .catch((err) => console.error("brief proposal failed:", err && err.message ? err.message : err))
    );
  }
  if (outlineNeedsRevision(book.outline, currentChapterNum(book))) {
    jobs.push(
      redrawOutline(book).catch((err) => console.error("outline revision failed:", err && err.message ? err.message : err))
    );
  }
  await Promise.all(jobs);
}

// Re-read the manuscript into the live notes. Never throws. Brings the chapter
// notes up to date first, so the analyzer sees the whole book through the
// digest (and the freshest cold read) even when the middle is elided.
//
// When a chapter has just closed, its audit has ruled on the suspected plot
// holes: the analyzer starts from the reconciled list (repaired and dismissed
// gaps gone, new ones added) rather than its own unverified one. Afterwards the
// planning layer catches up — a brief proposal, a redrawn outline.
export async function refreshAnalysis(book, prior) {
  const startedAt = Date.now();
  await refreshChapterNotes(book);
  const audited = latestAudit(book);
  const fresh = Boolean(audited && audited.audit && audited.audit.at >= startedAt);
  const reconciled = fresh ? reconcileHoles(prior && prior.holes, audited.audit) : null;
  const dismissed = audited ? dismissedHoles(audited.audit).join("\n") : "";
  let analysed = false;
  try {
    const analysis = await analyzeStory({
      title: book.title,
      fullText: manuscriptText(book),
      prior: prior && fresh ? { ...prior, holes: reconciled } : prior,
      brief: briefBlock(book.brief, totalWords(book)),
      outline: book.ended ? "" : outlineBlock(book.outline, currentChapterNum(book)),
      audit: auditBlock(audited),
      dismissed,
      guide: book.mode === "guide",
      arc: book.arc,
      sections: sectionCount(book),
      digest: chapterDigest(book),
      coldRead: latestColdRead(book),
      chapterNum: currentChapterNum(book),
      rubric: rubricFor(book),
      ...reviewLean(book),
    });
    if (analysis) {
      book.analysis = analysis;
      resolveDoneSuggestions(book, analysis);
      recordScore(book);
      analysed = true;
    }
  } catch (err) {
    // Keep the previous analysis, but leave a trace — a silently failing
    // refresh looks identical to a healthy one from the client.
    console.error("analysis refresh failed:", err && err.message ? err.message : err);
  }
  // The audit's ruling on the holes stands even if the analyzer didn't run.
  if (!analysed && fresh && book.analysis && book.analysis.updatedAt) {
    book.analysis = { ...book.analysis, holes: reconciled };
  }
  try {
    await refreshPlanning(book);
  } catch (err) {
    console.error("planning refresh failed:", err && err.message ? err.message : err);
  }
}

// The one-time evaluation of a finished book: close its last chapter (summary,
// cold read, final audit), then read the ENTIRE manuscript into the final
// assessment. Never throws; a failed read keeps the notes as they were.
export async function finalReview(book) {
  try {
    await refreshChapterNotes(book);
    const analysis = await analyzeStory({
      title: book.title,
      fullText: fullManuscript(book),
      prior: null,
      guide: book.mode === "guide",
      arc: book.arc,
      sections: sectionCount(book),
      final: true,
      digest: chapterDigest(book),
      coldRead: latestColdRead(book),
      chapterNum: currentChapterNum(book),
      rubric: rubricFor(book),
      brief: briefBlock(book.brief, totalWords(book)),
      audit: auditBlock(latestAudit(book)),
      ...reviewLean(book),
    });
    if (analysis) {
      book.analysis = analysis;
      recordScore(book);
    }
  } catch (err) {
    console.error("final review failed:", err && err.message ? err.message : err);
  }
}

// Wrap a generator routine in a newline-delimited JSON streaming Response.
// `run(send)` receives a `send(obj)` that emits one event per line.
export function ndjsonResponse(run) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        await run(send);
      } catch (err) {
        const msg = providerErrorMessage(err, "The AI author could not continue. Your text was not saved — try again.");
        try {
          send({ t: "error", error: msg });
        } catch {}
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
