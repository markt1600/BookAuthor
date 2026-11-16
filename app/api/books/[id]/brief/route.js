import { NextResponse } from "next/server";
import { getBook } from "@/lib/store";
import { proposeBrief } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";
import { providerErrorMessage } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Propose a brief — the book's stated aims — from the story so far. Nothing is
// saved here: the client loads the proposal into the brief editor and the
// author's Save (the normal PUT, `brief`) is what confirms it. Only a confirmed
// brief is ever used in a prompt.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }
  if (!(book.turns || []).length) {
    return NextResponse.json({ error: "Write something first — there's no story to read yet." }, { status: 400 });
  }

  try {
    const brief = await proposeBrief(book);
    if (!brief) return NextResponse.json({ error: "Couldn't draft a brief from the story — try again." }, { status: 502 });
    return NextResponse.json({ brief });
  } catch (err) {
    const msg = providerErrorMessage(err, "Couldn't draft a brief from the story — try again.");
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
