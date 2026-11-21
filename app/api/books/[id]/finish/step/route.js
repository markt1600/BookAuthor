import { NextResponse } from "next/server";
import { getBook, saveBook, acquireLock, releaseLock } from "@/lib/store";
import { publicBook } from "@/lib/book";
import { afterFinishSection, canFinish, FinishError, writeFinishSection } from "@/lib/finish";
import { carryNotes, carryRevision, ndjsonResponse, notesEvent, reportOnSection, retryAfterDrop } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
// One section, then its follow-up (notes; at a chapter's end the audit, the
// outline redraw and the next chapter's breakdown). Same ceiling as a turn.
export const maxDuration = 300;

// Finish the book — one step of the run. Each call writes the NEXT section of
// the plan and streams it exactly like a directed section; the client calls
// again until the book reports `ended`. Stopping is simply not calling again,
// so the run can be paused and resumed between any two sections.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }
  const why = canFinish(book);
  if (why) return NextResponse.json({ error: why }, { status: 400 });
  if (!book.finish) {
    return NextResponse.json({ error: "There is no plan to the end yet — plan the rest of the book first." }, { status: 400 });
  }

  // An optional live suggestion from the author for this section.
  let steer = "";
  try {
    steer = String((await request.json()).steer || "");
  } catch {
    steer = "";
  }

  const lock = await acquireLock(id);
  if (!lock) {
    return NextResponse.json(
      { error: "The AI author is already writing — wait for the current section to finish." },
      { status: 409 }
    );
  }
  const priorAnalysis = book.analysis && book.analysis.updatedAt ? book.analysis : null;

  return ndjsonResponse(async (send) => {
    try {
      let result;
      try {
        result = await writeFinishSection(book, { send, priorAnalysis, steer, persist: () => saveBook(book) });
      } catch (err) {
        if (!(err instanceof FinishError)) throw err;
        send({ t: "error", error: err.message });
        return;
      }
      await saveBook(book); // the section is safe before the slower follow-up
      send({ t: "generated" });
      send({ t: "done", book: publicBook(book), addedTurnIds: [result.section.id] });

      const before = structuredClone(book);
      await afterFinishSection(book, priorAnalysis, result);
      // A section that cost the book more than a few points is rewritten once
      // against the criticism; the better-scoring attempt is kept.
      const retry = await retryAfterDrop(book, before, priorAnalysis, {
        turnId: result.section.id,
        send,
        followUp: (trial) => afterFinishSection(trial, priorAnalysis, result),
      });
      // Re-read so a concurrent edit isn't clobbered, then merge in the notes,
      // the redrawn outline and the next chapter's breakdown.
      const latest = carryNotes((await getBook(id)) || book, book);
      if (latest.finish) latest.finish = book.finish; // unless the plan was dropped meanwhile
      const revised = Boolean(retry && retry.kept === "revised" && carryRevision(latest, book, result.section.id));
      await saveBook(latest);
      if (retry) send({ t: "retry", stage: "done", ...retry, ...(revised ? { book: publicBook(latest) } : {}) });
      send(notesEvent(latest));

      // Last, a short account of what the section did (the author's live note,
      // the plot, the criticism) — after the notes, so the score is the new one.
      const turn = book.turns.find((t) => t.id === result.section.id) || result.section;
      await reportOnSection(book, priorAnalysis, { turn, steer, retry });
      const after = (await getBook(id)) || latest;
      after.sectionReport = book.sectionReport;
      await saveBook(after);
      send({ t: "report", sectionReport: after.sectionReport });
    } finally {
      await releaseLock(id, lock);
    }
  });
}
