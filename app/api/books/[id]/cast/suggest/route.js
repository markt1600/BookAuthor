import { NextResponse } from "next/server";
import { getBook } from "@/lib/store";
import { manuscriptText } from "@/lib/book";
import { suggestCast } from "@/lib/claude";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Propose cast-sheet entries from the manuscript. Nothing is saved here — the
// client adds accepted suggestions through the normal PATCH (characters) path,
// so the author stays in the loop on every entry.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }
  if (!(book.turns || []).length) {
    return NextResponse.json({ error: "Write something first — there's no cast to find yet." }, { status: 400 });
  }

  try {
    const suggestions = await suggestCast({
      title: book.title,
      fullText: manuscriptText(book, 30000),
      continuity: (book.analysis && book.analysis.continuity) || "",
      voices: (book.analysis && book.analysis.voices) || "",
      existing: (book.characters || []).map((c) => c.name).join(", "),
    });
    return NextResponse.json({ suggestions });
  } catch (err) {
    const msg =
      err && err.code === "NO_API_KEY"
        ? "The server is missing ANTHROPIC_API_KEY."
        : "Couldn't read the manuscript for characters — try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
