import { NextResponse } from "next/server";
import { applyPatch, truncateAt, mergeFullText } from "@/lib/book";
import { getBook, saveBook, deleteBook } from "@/lib/store";
import { isAuthed } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  return NextResponse.json({ book });
}

export async function DELETE(request, { params }) {
  if (!isAuthed(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await deleteBook(id);
  return NextResponse.json({ ok: true });
}

export async function PUT(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Full-manuscript edit: replace the book's text with the edited version.
  if (typeof body.fullText === "string") {
    const merged = mergeFullText(book, body.fullText);
    await saveBook(merged);
    return NextResponse.json({ book: merged });
  }

  let next = applyPatch(book, body);

  // Forking: drop everything from `truncateFrom` (a turn index) onward.
  if (Number.isInteger(body.truncateFrom)) {
    next = truncateAt(next, body.truncateFrom);
  }

  await saveBook(next);
  return NextResponse.json({ book: next });
}
