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
import { continueStory, analyzeStory } from "@/lib/claude";

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
  if (!text) {
    return NextResponse.json({ error: "Write something first." }, { status: 400 });
  }
  if (!isUsersMove(book)) {
    return NextResponse.json(
      { error: "It is not your move yet." },
      { status: 409 }
    );
  }

  // 1) Commit the user's turn.
  const userTurn = makeTurn("user", text);
  book.turns.push(userTurn);

  // 2) Ask the AI author to continue in the established voice, ~matching length.
  //    It gets a cumulative continuity record (from the prior analysis) plus the
  //    opening and the recent passages, so early characters aren't forgotten.
  let claudeTurn = null;
  const priorAnalysis = book.analysis && book.analysis.updatedAt ? book.analysis : null;
  try {
    const callArgs = {
      title: book.title,
      author: book.author,
      settings: book.settings,
      memory: priorAnalysis,
      targetWords: countWords(text),
    };
    const whole = fullManuscript(book);
    if (book.settings.fullContext && countWords(whole) <= FULL_CONTEXT_WORD_CAP) {
      callArgs.whole = whole; // send the entire manuscript
    } else {
      const parts = continuationParts(book); // layered: opening + recent + memory
      callArgs.opening = parts.opening;
      callArgs.recent = parts.recent;
    }
    const continuation = await continueStory(callArgs);
    claudeTurn = makeTurn("claude", continuation);
    book.turns.push(claudeTurn);
  } catch (err) {
    // Roll back the user's turn so the client can retry cleanly.
    book.turns.pop();
    const status = err.code === "NO_API_KEY" ? 500 : 502;
    const message =
      err.code === "NO_API_KEY"
        ? "The server is missing ANTHROPIC_API_KEY."
        : "The AI author could not continue the story. Your text was not saved — try again.";
    return NextResponse.json({ error: message }, { status });
  }

  // 3) Refresh the live analysis. Never let this block the turn.
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

  await saveBook(book);
  return NextResponse.json({ book, addedTurnIds: [userTurn.id, claudeTurn.id] });
}
