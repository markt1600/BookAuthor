import { NextResponse } from "next/server";
import { applyPatch, truncateAt, mergeFullText, manuscriptText, publicBook } from "@/lib/book";
import { getBook, saveBook, deleteBook, saveSnapshot, deleteSnapshots } from "@/lib/store";
import { isAuthed, bookUnlocked } from "@/lib/admin";
import { analyzeStory } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ locked: true, title: book.title || "Untitled" }, { status: 401 });
  }
  return NextResponse.json({ book: publicBook(book) });
}

export async function DELETE(request, { params }) {
  if (!isAuthed(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await deleteBook(id);
  await deleteSnapshots(id);
  return NextResponse.json({ ok: true });
}

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
  } catch {
    body = {};
  }

  // Full-manuscript edit: replace the book's text with the edited version.
  if (typeof body.fullText === "string") {
    await saveSnapshot(book, "Before full-text edit");
    const merged = mergeFullText(book, body.fullText);
    if (merged.turns.length) {
      // A full-text edit can change anything — rename or remove characters,
      // alter facts, rewrite the arc. So run the FULL analysis afresh and rebuild
      // every note: synopsis, story memory/cast, genre, style, score, the in-depth
      // critique, the "ways the next section could answer this" suggestions, and
      // the suggested next direction. Passing prior:null prevents the old analysis
      // (which could keep characters or facts the edit removed) from carrying over.
      try {
        const analysis = await analyzeStory({
          title: merged.title,
          fullText: manuscriptText(merged),
          prior: null,
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
        critique: "",
        nextDirection: "",
        suggestions: "",
        continuity: "",
        updatedAt: 0,
      };
    }
    await saveBook(merged);
    return NextResponse.json({ book: publicBook(merged) });
  }

  let next = applyPatch(book, body);

  // Snapshot before chapter changes (reversible via revision history).
  if (Array.isArray(body.chapters)) {
    await saveSnapshot(book, "Before chapter change");
  }

  // Forking: drop everything from `truncateFrom` (a turn index) onward.
  if (Number.isInteger(body.truncateFrom)) {
    await saveSnapshot(book, "Before trimming the manuscript");
    next = truncateAt(next, body.truncateFrom);
  }

  await saveBook(next);
  return NextResponse.json({ book: publicBook(next) });
}
