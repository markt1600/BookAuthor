import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import {
  makeTurn,
  countWords,
  isUsersMove,
  recentContext,
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

  // 2) Ask Claude to continue in the established voice, ~matching length.
  let claudeTurn = null;
  try {
    const continuation = await continueStory({
      title: book.title,
      author: book.author,
      settings: book.settings,
      context: recentContext(book),
      targetWords: countWords(text),
    });
    claudeTurn = makeTurn("claude", continuation);
    book.turns.push(claudeTurn);
  } catch (err) {
    // Roll back the user's turn so the client can retry cleanly.
    book.turns.pop();
    const status = err.code === "NO_API_KEY" ? 500 : 502;
    const message =
      err.code === "NO_API_KEY"
        ? "The server is missing ANTHROPIC_API_KEY."
        : "Claude could not continue the story. Your text was not saved — try again.";
    return NextResponse.json({ error: message }, { status });
  }

  // 3) Refresh the live analysis. Never let this block the turn.
  try {
    const analysis = await analyzeStory({
      title: book.title,
      fullText: manuscriptText(book),
    });
    if (analysis) book.analysis = analysis;
  } catch {
    // keep previous analysis
  }

  await saveBook(book);
  return NextResponse.json({ book, addedTurnIds: [userTurn.id, claudeTurn.id] });
}
