import {
  countWords,
  continuationParts,
  fullManuscript,
  FULL_CONTEXT_WORD_CAP,
  manuscriptText,
  positionLine,
  sectionCount,
} from "@/lib/book";
import { analyzeStory } from "@/lib/claude";

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
// canon, the optional voice sample, and where the writing currently stands.
export function authorContext(book) {
  return {
    bible: (book.bible || "").trim(),
    voiceSample: (book.voiceSample || "").trim(),
    position: positionLine(book),
  };
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
    }
  } catch {
    // keep the previous analysis
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
