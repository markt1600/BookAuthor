import { NextResponse } from "next/server";
import { newBook } from "@/lib/book";
import { saveBook } from "@/lib/store";

export const dynamic = "force-dynamic";

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
  });

  await saveBook(book);
  return NextResponse.json({ id: book.id, book }, { status: 201 });
}
