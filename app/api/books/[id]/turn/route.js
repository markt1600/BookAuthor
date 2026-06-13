import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import { makeTurn, countWords, isUsersMove } from "@/lib/book";
import { continueStory, guideStory } from "@/lib/claude";
import { withContext, refreshAnalysis, ndjsonResponse } from "@/lib/generate";

export const dynamic = "force-dynamic";
// Generating prose + analysis can take a while; give it room on Vercel.
export const maxDuration = 60;

export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const text = String(body.text || "").trim();
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

  // Stream the prose as it's written, then finalize (commit + analysis + save).
  return ndjsonResponse(async (send) => {
    const onDelta = (d) => send({ t: "delta", d });

    if (guideMode) {
      const prose = await guideStory(
        withContext(book, {
          title: book.title,
          author: book.author,
          guide: book.guide,
          prompt: text,
          memory: priorAnalysis,
          targetWords: (book.guide && book.guide.sectionWords) || 275,
          onDelta,
        })
      );
      const section = makeTurn("claude", prose, text); // store the originating direction
      book.turns.push(section);
      send({ t: "generated" });
      await refreshAnalysis(book, priorAnalysis);
      await saveBook(book);
      send({ t: "done", book, addedTurnIds: [section.id] });
      return;
    }

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
          onDelta,
        })
      );
      claudeTurn = makeTurn("claude", continuation);
      book.turns.push(claudeTurn);
    } catch (err) {
      book.turns.pop(); // roll back the user's turn
      throw err;
    }
    send({ t: "generated" });
    await refreshAnalysis(book, priorAnalysis);
    await saveBook(book);
    send({ t: "done", book, addedTurnIds: [userTurn.id, claudeTurn.id] });
  });
}
