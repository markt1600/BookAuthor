import {
  countWords,
  continuationParts,
  fullManuscript,
  FULL_CONTEXT_WORD_CAP,
  manuscriptText,
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

// Re-read the manuscript into the live notes. Never throws.
export async function refreshAnalysis(book, prior) {
  try {
    const analysis = await analyzeStory({
      title: book.title,
      fullText: manuscriptText(book),
      prior,
      guide: book.mode === "guide",
      eroticaLean:
        book.mode === "guide" &&
        book.guide &&
        book.guide.adult &&
        book.guide.erotica &&
        book.guide.sexual === 3,
    });
    if (analysis) book.analysis = analysis;
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
