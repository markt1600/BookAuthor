import { NextResponse } from "next/server";
import { getBook, saveBook, acquireLock, releaseLock } from "@/lib/store";
import { publicBook } from "@/lib/book";
import { cancelFinish, FinishError, planFinish } from "@/lib/finish";
import { bookUnlocked } from "@/lib/admin";
import { providerErrorMessage } from "@/lib/providers";

export const dynamic = "force-dynamic";
// Planning to the end is two or three model calls on the analysis model (close
// the chapter in progress if it is done, draw the outline, break down the
// first chapter).
export const maxDuration = 300;

// Finish the book — the plan. POST { action: "plan" } draws (or redraws) the
// outline all the way to the last chapter and prepares the first chapter of the
// run; nothing is written until the author starts it (see ./step).
// POST { action: "cancel" } drops the plan and returns to the rolling outline.
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
  const action = body.action === "cancel" ? "cancel" : "plan";

  const lock = await acquireLock(id);
  if (!lock) {
    return NextResponse.json({ error: "The AI author is writing — wait for the current section to finish." }, { status: 409 });
  }
  try {
    if (action === "cancel") {
      cancelFinish(book);
      await saveBook(book);
      return NextResponse.json({ book: publicBook(book) });
    }
    await planFinish(book);
    // Save only what planning produced onto the latest copy, so an edit made
    // while it ran is not overwritten.
    const latest = (await getBook(id)) || book;
    latest.outline = book.outline;
    latest.finish = book.finish;
    latest.chapterNotes = book.chapterNotes;
    await saveBook(latest);
    return NextResponse.json({ book: publicBook(latest) });
  } catch (err) {
    if (err instanceof FinishError) return NextResponse.json({ error: err.message }, { status: 400 });
    const msg = providerErrorMessage(err, "Couldn't draw up a plan to the end — try again.");
    return NextResponse.json({ error: msg }, { status: 502 });
  } finally {
    await releaseLock(id, lock);
  }
}
