import { NextResponse } from "next/server";
import { getBook } from "@/lib/store";
import { STYLE_PROFILE } from "@/lib/book";
import { suggestOpening } from "@/lib/claude";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Guide mode, blank book, author style (Hemingway / Murakami / Burdett):
// propose the opening direction the director could give, in that author's
// territory and within the book's maturity settings. Nothing is saved — the
// client pre-fills the composer and the director accepts or rewrites it.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }
  const style = book.guide && book.guide.style;
  if (book.mode !== "guide" || (book.turns || []).length || !STYLE_PROFILE[style]) {
    return NextResponse.json({ error: "No opening to suggest for this book." }, { status: 400 });
  }

  try {
    const suggestion = await suggestOpening({ title: book.title, guide: book.guide });
    if (!suggestion) throw new Error("empty suggestion");
    return NextResponse.json({ suggestion });
  } catch (err) {
    const msg =
      err && err.code === "NO_API_KEY"
        ? "The server is missing ANTHROPIC_API_KEY."
        : "Couldn't suggest an opening — try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
