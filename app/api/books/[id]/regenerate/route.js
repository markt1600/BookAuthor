import { NextResponse } from "next/server";
import { getBook, saveBook, saveSnapshot, acquireLock, releaseLock } from "@/lib/store";
import { makeTurn, countWords, publicBook, sectionCount } from "@/lib/book";
import { continueStory, guideStory } from "@/lib/claude";
import { withContext, refreshAnalysis, ndjsonResponse, authorContext, produceSection } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
// Match the turn route: room for a large context plus the follow-up analysis.
export const maxDuration = 300;

// Re-write the most recent AI passage with a fresh take. The prior version is
// snapshotted first (revision history), so a regenerate is reversible.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }

  const turns = book.turns || [];
  const last = turns[turns.length - 1];
  const guideMode = book.mode === "guide";

  if (!last || last.author !== "claude") {
    return NextResponse.json({ error: "There is no AI passage to regenerate yet." }, { status: 400 });
  }
  if (guideMode && !last.prompt) {
    return NextResponse.json(
      { error: "This section has no saved direction to regenerate from." },
      { status: 400 }
    );
  }

  const lock = await acquireLock(id);
  if (!lock) {
    return NextResponse.json(
      { error: "The AI author is already writing — wait for the current section to finish." },
      { status: 409 }
    );
  }

  const priorAnalysis = book.analysis && book.analysis.updatedAt ? book.analysis : null;
  await saveSnapshot(book, "Before regenerating a section");

  // Drop the AI passage; regenerate from exactly the same point.
  const removed = turns.pop();
  const directionPrompt = removed.prompt || "";

  return ndjsonResponse(async (send) => {
    try {
      if (guideMode) {
        const prose = await produceSection({
          book,
          priorAnalysis,
          send,
          makeDraft: (onDelta, variant) =>
            guideStory(
              withContext(book, {
                title: book.title,
                author: book.author,
                guide: book.guide,
                prompt: directionPrompt,
                memory: priorAnalysis,
                arc: book.arc,
                sections: sectionCount(book),
                targetWords: (book.guide && book.guide.sectionWords) || 275,
                ...authorContext(book),
                variant,
                onDelta,
              })
            ),
        });
        const section = makeTurn("claude", prose, directionPrompt);
        book.turns.push(section);
        await saveBook(book); // persist before the slower analysis call
        send({ t: "generated" });
        send({ t: "done", book: publicBook(book), addedTurnIds: [section.id] });
        await refreshAnalysis(book, priorAnalysis);
        const latest = (await getBook(id)) || book;
        latest.analysis = book.analysis;
        await saveBook(latest);
        send({ t: "analysis", analysis: latest.analysis });
        return;
      }

      // Participate: the preceding user turn (now last) is what we continue from.
      const prevUser = book.turns[book.turns.length - 1];
      const target = prevUser && prevUser.text ? countWords(prevUser.text) : 150;
      const continuation = await produceSection({
        book,
        priorAnalysis,
        send,
        makeDraft: (onDelta, variant) =>
          continueStory(
            withContext(book, {
              title: book.title,
              author: book.author,
              settings: book.settings,
              memory: priorAnalysis,
              targetWords: target,
              arc: book.arc,
              sections: sectionCount(book),
              ...authorContext(book),
              variant,
              onDelta,
            })
          ),
      });
      const claudeTurn = makeTurn("claude", continuation);
      book.turns.push(claudeTurn);
      await saveBook(book); // persist before the slower analysis call
      send({ t: "generated" });
      send({ t: "done", book: publicBook(book), addedTurnIds: [claudeTurn.id] });
      await refreshAnalysis(book, priorAnalysis);
      const latest = (await getBook(id)) || book;
      latest.analysis = book.analysis;
      await saveBook(latest);
      send({ t: "analysis", analysis: latest.analysis });
    } finally {
      await releaseLock(id, lock);
    }
  });
}
