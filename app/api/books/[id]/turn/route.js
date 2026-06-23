import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import { makeTurn, countWords, isUsersMove, publicBook, normalizeChapters, sectionCount } from "@/lib/book";
import { continueStory, guideStory } from "@/lib/claude";
import { withContext, refreshAnalysis, ndjsonResponse } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
// Long books carry a large context, and the section is followed by a second
// (analysis) model call. Give the whole thing generous room on Vercel — this is
// clamped to your plan's ceiling (Hobby 60s, Pro up to 300s).
export const maxDuration = 300;

export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const text = String(body.text || "").trim();
  const wantsChapter = body.newChapter === true;
  const guideMode = book.mode === "guide";
  if (!text) {
    return NextResponse.json(
      { error: guideMode ? "Describe what happens next first." : "Write something first." },
      { status: 400 }
    );
  }
  if (!isUsersMove(book)) {
    return NextResponse.json({ error: "It is not your move yet." }, { status: 409 });
  }

  const priorAnalysis = book.analysis && book.analysis.updatedAt ? book.analysis : null;

  // Open a new chapter at the given turn index, if requested.
  const addChapter = (startTurn) => {
    if (!wantsChapter) return;
    book.chapters = normalizeChapters(
      [...(book.chapters || []), { startTurn: Math.max(0, startTurn), title: "" }],
      book.turns.length
    );
  };

  // Stream the prose, COMMIT + SAVE + deliver it, THEN refresh the notes as a
  // best-effort follow-up. Decoupling the analysis means a slow second call on a
  // long book can never drop the connection or lose the section that was written.
  return ndjsonResponse(async (send) => {
    const onDelta = (d) => send({ t: "delta", d });

    let addedTurnIds;
    if (guideMode) {
      const prose = await guideStory(
        withContext(book, {
          title: book.title,
          author: book.author,
          guide: book.guide,
          prompt: text,
          memory: priorAnalysis,
          arc: book.arc,
          sections: sectionCount(book),
          targetWords: (book.guide && book.guide.sectionWords) || 275,
          onDelta,
        })
      );
      const section = makeTurn("claude", prose, text); // store the originating direction
      book.turns.push(section);
      addChapter(book.turns.length - 1); // chapter opens on the new section
      addedTurnIds = [section.id];
    } else {
      // Participate: commit the user's turn, then continue in one voice.
      const userTurn = makeTurn("user", text);
      book.turns.push(userTurn);
      let claudeTurn = null;
      try {
        const continuation = await continueStory(
          withContext(book, {
            title: book.title,
            author: book.author,
            settings: book.settings,
            memory: priorAnalysis,
            targetWords: countWords(text),
            arc: book.arc,
          sections: sectionCount(book),
            onDelta,
          })
        );
        claudeTurn = makeTurn("claude", continuation);
        book.turns.push(claudeTurn);
      } catch (err) {
        book.turns.pop(); // roll back the user's turn
        throw err;
      }
      addChapter(book.turns.length - 2); // chapter opens on the user's turn
      addedTurnIds = [userTurn.id, claudeTurn.id];
    }

    await saveBook(book); // persist the section before the (slower) analysis
    send({ t: "generated" });
    send({ t: "done", book: publicBook(book), addedTurnIds });

    // Best-effort notes refresh. refreshAnalysis never throws; re-read the latest
    // book first so we don't clobber any concurrent edit, then merge the notes in.
    await refreshAnalysis(book, priorAnalysis);
    const latest = (await getBook(id)) || book;
    latest.analysis = book.analysis;
    await saveBook(latest);
    send({ t: "analysis", analysis: latest.analysis });
  });
}
