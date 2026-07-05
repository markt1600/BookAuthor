import { NextResponse } from "next/server";
import { getBook, saveBook, saveSnapshot, acquireLock, releaseLock } from "@/lib/store";
import { countWords, publicBook } from "@/lib/book";
import { selfEditSection } from "@/lib/claude";
import { lintProse } from "@/lib/craft";
import { refreshAnalysis, ndjsonResponse } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One-tap "fix these": re-run the line-edit pass over the most recent AI
// section with the mechanical tell-linter's findings as the repair list. The
// section is replaced in place (story events and length preserved — that's the
// polish pass's contract) and the prior version is snapshotted to History.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }

  // Target the most recent AI-written section — the one the notes card scans.
  const turns = book.turns || [];
  let idx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i] && turns[i].author === "claude" && turns[i].text) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    return NextResponse.json({ error: "There is no AI-written section to fix yet." }, { status: 400 });
  }

  // Re-lint server-side so the repair list always matches the stored text.
  const lint = lintProse(turns[idx].text);
  if (!lint.length) {
    return NextResponse.json(
      { error: "This section already reads clean — nothing to fix." },
      { status: 400 }
    );
  }

  const lock = await acquireLock(id);
  if (!lock) {
    return NextResponse.json(
      { error: "The AI author is already writing — wait for the current job to finish." },
      { status: 409 }
    );
  }

  const priorAnalysis = book.analysis && book.analysis.updatedAt ? book.analysis : null;
  await saveSnapshot(book, "Before fixing prose tells");

  return ndjsonResponse(async (send) => {
    try {
      send({ t: "polish" }); // label the stream as a polishing pass in the UI
      const onDelta = (d) => send({ t: "delta", d });

      const fixed = await selfEditSection({
        title: book.title,
        mode: book.mode,
        guide: book.guide,
        draft: turns[idx].text,
        memory: priorAnalysis,
        lint,
        onDelta,
      });

      const clean = String(fixed).replace(/\s+$/g, "");
      book.turns[idx] = {
        ...turns[idx],
        text: clean,
        words: countWords(clean),
        polishedAt: Date.now(),
      };

      await saveBook(book); // persist before the slower analysis call
      send({ t: "generated" });
      send({ t: "done", book: publicBook(book), addedTurnIds: [book.turns[idx].id] });

      await refreshAnalysis(book, priorAnalysis);
      const latest = (await getBook(id)) || book;
      latest.analysis = book.analysis;
      latest.scoreHistory = book.scoreHistory;
      await saveBook(latest);
      send({ t: "analysis", analysis: latest.analysis });
    } finally {
      await releaseLock(id, lock);
    }
  });
}
