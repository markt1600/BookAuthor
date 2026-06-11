import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import {
  makeTurn,
  countWords,
  isUsersMove,
  continuationParts,
  fullManuscript,
  FULL_CONTEXT_WORD_CAP,
  manuscriptText,
} from "@/lib/book";
import { continueStory, guideStory, analyzeStory } from "@/lib/claude";

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

  const apiError = (err) => {
    const status = err.code === "NO_API_KEY" ? 500 : 502;
    const message =
      err.code === "NO_API_KEY"
        ? "The server is missing ANTHROPIC_API_KEY."
        : "The AI author could not continue the story. Your text was not saved — try again.";
    return NextResponse.json({ error: message }, { status });
  };

  // Build the generation context (whole book, or layered opening + recent).
  const withContext = (args) => {
    const whole = fullManuscript(book);
    if (book.settings.fullContext && countWords(whole) <= FULL_CONTEXT_WORD_CAP) {
      args.whole = whole;
    } else {
      const parts = continuationParts(book);
      args.opening = parts.opening;
      args.recent = parts.recent;
    }
    return args;
  };

  const refreshAnalysis = async () => {
    try {
      const analysis = await analyzeStory({
        title: book.title,
        fullText: manuscriptText(book),
        prior: priorAnalysis,
      });
      if (analysis) book.analysis = analysis;
    } catch {
      // keep previous analysis
    }
  };

  // ---- GUIDE MODE: the user directs; the AI writes the whole section. ----
  if (guideMode) {
    let section = null;
    try {
      const prose = await guideStory(
        withContext({
          title: book.title,
          author: book.author,
          guide: book.guide,
          prompt: text,
          memory: priorAnalysis,
          targetWords: (book.guide && book.guide.sectionWords) || 275,
        })
      );
      section = makeTurn("claude", prose, text); // store the originating direction
      book.turns.push(section);
    } catch (err) {
      return apiError(err);
    }
    await refreshAnalysis();
    await saveBook(book);
    return NextResponse.json({ book, addedTurnIds: [section.id] });
  }

  // ---- PARTICIPATE MODE: trade passages in one shared voice. ----
  // 1) Commit the user's turn.
  const userTurn = makeTurn("user", text);
  book.turns.push(userTurn);

  // 2) Ask the AI author to continue in the established voice, ~matching length.
  let claudeTurn = null;
  try {
    const continuation = await continueStory(
      withContext({
        title: book.title,
        author: book.author,
        settings: book.settings,
        memory: priorAnalysis,
        targetWords: countWords(text),
      })
    );
    claudeTurn = makeTurn("claude", continuation);
    book.turns.push(claudeTurn);
  } catch (err) {
    book.turns.pop(); // roll back the user's turn
    return apiError(err);
  }

  // 3) Refresh the live analysis. Never let this block the turn.
  await refreshAnalysis();

  await saveBook(book);
  return NextResponse.json({ book, addedTurnIds: [userTurn.id, claudeTurn.id] });
}
