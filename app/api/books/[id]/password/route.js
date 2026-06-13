import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import { isAuthed, hashBookPassword } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Set, change, or remove a book's password. Admin only. Send { password: "…" }
// to set/change, or { password: "" } (or null) to remove protection.
export async function PUT(request, { params }) {
  if (!isAuthed(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  let body = {};
  try {
    body = await request.json();
  } catch {}

  const pw = body.password == null ? "" : String(body.password);
  if (pw.trim() === "") {
    delete book.passwordHash;
  } else {
    book.passwordHash = hashBookPassword(pw);
  }
  book.updatedAt = Date.now();
  await saveBook(book);
  return NextResponse.json({ ok: true, protected: Boolean(book.passwordHash) });
}
