import { NextResponse } from "next/server";
import { applyPatch, truncateAt, mergeFullText, manuscriptText } from "@/lib/book";
import { getBook, saveBook, deleteBook } from "@/lib/store";
import { isAuthed } from "@/lib/admin";
import { analyzeStory } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    if (merged.turns.length) {
      // Re-read the edited manuscript so the synopsis, story memory, and the
      // suggested next direction reflect the new text — not the prior turns or
      // their (now-discarded) prompts.
      try {
        const prior = book.analysis && book.analysis.updatedAt ? book.analysis : null;
        const analysis = await analyzeStory({
          title: merged.title,
          fullText: manuscriptText(merged),
          prior,
          guide: merged.mode === "guide",
          eroticaLean:
            merged.mode === "guide" &&
            merged.guide &&
            merged.guide.adult &&
            merged.guide.erotica &&
            merged.guide.sexual === 3,
        });
        if (analysis) merged.analysis = analysis;
      } catch {
        // keep the prior analysis if the re-read fails (e.g. no API key)
      }
    } else {
      // Book emptied — clear any stale notes/suggestion.
      merged.analysis = {
        style: "",
        genre: "",
        synopsis: "",
        quality: "",
        qualityScore: null,
        nextDirection: "",
        continuity: "",
        updatedAt: 0,
      };
    }
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
