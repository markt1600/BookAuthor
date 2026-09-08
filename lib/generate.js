import {
  castText,
  chapterDigest,
  countWords,
  continuationParts,
  currentChapterNum,
  fullManuscript,
  FULL_CONTEXT_WORD_CAP,
  latestColdRead,
  manuscriptText,
  positionLine,
  pruneChapterNotes,
  recordScore,
  sectionCount,
  staleChapters,
  textFingerprint,
} from "@/lib/book";
import { analyzeStory, coldReadChapter, pickTake, selfEditSection, summarizeChapter } from "@/lib/claude";
import { lintProse, varietyBlock, STYLE_EXEMPLAR, SECOND_TAKE_NOTE } from "@/lib/craft";

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
export function authorContext(book) {
  const own = (book.voiceSample || "").trim();
  const exemplar =
    book.mode === "guide" ? STYLE_EXEMPLAR[(book.guide && book.guide.style) || ""] || "" : "";
  return {
    bible: (book.bible || "").trim(),
    cast: castText(book),
    voiceSample: own || exemplar,
    position: positionLine(book),
    variety: varietyBlock(book),
    digest: chapterDigest(book),
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
export async function produceSection({ book, priorAnalysis, send, makeDraft, makePlan, meta }) {
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
        if ((await pickTake({ title: book.title, a: prose, b: second })) === "B") prose = second;
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
const CHAPTER_WORK_CAP = 4;
export async function refreshChapterNotes(book) {
  try {
    pruneChapterNotes(book);
    const stale = staleChapters(book).slice(0, CHAPTER_WORK_CAP);
    if (!stale.length) return false;
    const notes = book.chapterNotes;
    for (const ch of stale) {
      // The digest of the chapters before this one gives the summarizer names
      // and context (and is available for earlier chapters already done).
      const prior = chapterDigest(book, ch.num);
      const [summary, cold] = await Promise.all([
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
      ]);
      if (!summary && !cold) continue; // both failed — leave it stale for a retry
      notes[ch.id] = {
        fp: textFingerprint(ch.text),
        num: ch.num,
        title: ch.title,
        words: countWords(ch.text),
        summary: summary || (notes[ch.id] && notes[ch.id].summary) || "",
        cold: cold || (notes[ch.id] && notes[ch.id].cold) || null,
        at: Date.now(),
      };
    }
    return true;
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
  return latest;
}

// Re-read the manuscript into the live notes. Never throws. Brings the chapter
// notes up to date first, so the analyzer sees the whole book through the
// digest (and the freshest cold read) even when the middle is elided.
export async function refreshAnalysis(book, prior) {
  await refreshChapterNotes(book);
  try {
    const analysis = await analyzeStory({
      title: book.title,
      fullText: manuscriptText(book),
      prior,
      guide: book.mode === "guide",
      arc: book.arc,
      sections: sectionCount(book),
      digest: chapterDigest(book),
      coldRead: latestColdRead(book),
      chapterNum: currentChapterNum(book),
      eroticaLean:
        book.mode === "guide" &&
        book.guide &&
        book.guide.adult &&
        book.guide.erotica &&
        book.guide.sexual === 3,
    });
    if (analysis) {
      book.analysis = analysis;
      resolveDoneSuggestions(book, analysis);
      recordScore(book);
    }
  } catch (err) {
    // Keep the previous analysis, but leave a trace — a silently failing
    // refresh looks identical to a healthy one from the client.
    console.error("analysis refresh failed:", err && err.message ? err.message : err);
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
        const msg =
          err && err.code === "NO_API_KEY"
            ? "The server is missing ANTHROPIC_API_KEY."
            : "The AI author could not continue. Your text was not saved — try again.";
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
