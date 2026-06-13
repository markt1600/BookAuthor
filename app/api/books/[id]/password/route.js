import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import { bookUnlocked, hashBookPassword, bookUnlockToken, bookCookieName } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Set, change, or remove a book's password. Allowed for an admin OR anyone who
// currently has the book open (no password yet, or a valid unlock). Send
// { password: "…" } to set/change, or { password: "" } (or null) to remove.
export async function PUT(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }

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

  const res = NextResponse.json({ ok: true, protected: Boolean(book.passwordHash) });
  // Keep whoever just set/changed the password unlocked (the cookie token is
  // derived from the hash, so a change would otherwise invalidate their access).
  if (book.passwordHash) {
    res.cookies.set(bookCookieName(id), bookUnlockToken(book), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    res.cookies.set(bookCookieName(id), "", { path: "/", maxAge: 0 });
  }
  return res;
}
