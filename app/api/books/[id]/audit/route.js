import { NextResponse } from "next/server";
import { getBook } from "@/lib/store";
import { castText, manuscriptText } from "@/lib/book";
import { auditConsistency } from "@/lib/claude";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// On-demand consistency audit: scan the manuscript for contradictions against
// itself, the author's canon, and the cast sheet. Read-only — nothing on the
// book changes, so no write lock and no snapshot.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }
  if (!(book.turns || []).length) {
    return NextResponse.json({ error: "There's nothing to check yet." }, { status: 400 });
  }

  try {
    const findings = await auditConsistency({
      title: book.title,
      // A far larger window than the per-turn analysis — an audit is exactly
      // the case where the middle of the book matters.
      fullText: manuscriptText(book, 100000),
      bible: (book.bible || "").trim(),
      cast: castText(book),
      continuity: (book.analysis && book.analysis.continuity) || "",
    });
    return NextResponse.json({ findings, at: Date.now() });
  } catch (err) {
    const msg =
      err && err.code === "NO_API_KEY"
        ? "The server is missing ANTHROPIC_API_KEY."
        : "The consistency check failed — try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
