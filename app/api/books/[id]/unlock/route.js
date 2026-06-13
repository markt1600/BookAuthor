import { NextResponse } from "next/server";
import { getBook } from "@/lib/store";
import { publicBook } from "@/lib/book";
import { checkBookPassword, bookUnlockToken, bookCookieName } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Exchange the correct book password for an access cookie, returning the book.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  if (!book.passwordHash) {
    // Not protected — nothing to unlock.
    return NextResponse.json({ book: publicBook(book) });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {}
  const password = String(body.password || "");

  if (!checkBookPassword(book, password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ book: publicBook(book) });
  res.cookies.set(bookCookieName(id), bookUnlockToken(book), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
