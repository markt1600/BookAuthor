import {
  castText,
  countWords,
  continuationParts,
  fullManuscript,
  FULL_CONTEXT_WORD_CAP,
  manuscriptText,
  positionLine,
  recordScore,
  sectionCount,
} from "@/lib/book";
import { analyzeStory, pickTake, selfEditSection } from "@/lib/claude";
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
  };
}

// The full section pipeline: draft — optionally draft a SECOND take from a
// different angle and let a judge keep the more human one — then optionally run
// the polish pass, fed with the mechanical tell-linter's findings. Emits
// "take" / "polish" stream events so the client can label each phase. Every
// extra also step degrades safely: a failed second take or judge keeps the
// first draft; a failed polish keeps the unpolished one.
export async function produceSection({ book, priorAnalysis, send, makeDraft }) {
  const onDelta = (d) => send({ t: "delta", d });
  const s = book.settings || {};

  let prose = await makeDraft(onDelta, "");

  if (s.bestOfTwo) {
    let second = null;
    try {
      send({ t: "take" });
      second = await makeDraft(onDelta, SECOND_TAKE_NOTE);
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

// Re-read the manuscript into the live notes. Never throws.
export async function refreshAnalysis(book, prior) {
  try {
    const analysis = await analyzeStory({
      title: book.title,
      fullText: manuscriptText(book),
      prior,
      guide: book.mode === "guide",
      arc: book.arc,
      sections: sectionCount(book),
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
