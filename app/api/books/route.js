import { NextResponse } from "next/server";
import { newBook, totalWords } from "@/lib/book";
import { saveBook, listBooks, storageMode } from "@/lib/store";
import { isAuthed } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Admin listing: a lightweight summary of every book in the store.
export async function GET(request) {
  if (!isAuthed(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const books = await listBooks();
  const items = books.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    turns: b.turns?.length || 0,
    words: totalWords(b),
    cover: b.settings?.cover || "classic",
    protected: Boolean(b.passwordHash),
    shared: Boolean(b.shared),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }));
  return NextResponse.json({ books: items, storageMode });
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const book = newBook({
    title: body.title,
    author: body.author,
    settings: body.settings,
    mode: body.mode,
    guide: body.guide,
  });

  await saveBook(book);
  return NextResponse.json({ id: book.id, book }, { status: 201 });
}
