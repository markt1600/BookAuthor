import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import {
  newBook,
  mergeFullText,
  fullManuscript,
  fullTextWithChapters,
  countWords,
  sectionCount,
  publicBook,
} from "@/lib/book";
import { reviseManuscript, analyzeStory } from "@/lib/claude";
import { ndjsonResponse } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
// A whole-book rewrite plus a final re-score — give it generous room.
export const maxDuration = 300;

// One-pass revision is bounded by what we can stream within the time budget.
const REVISE_WORD_CAP = 7000;

export async function POST(request, { params }) {
  const { id } = await params;
  const src = await getBook(id);
  if (!src) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, src)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }
  if (!src.turns || !src.turns.length) {
    return NextResponse.json({ error: "There's nothing to revise yet." }, { status: 400 });
  }

  const words = countWords(fullManuscript(src));
  if (words > REVISE_WORD_CAP) {
    return NextResponse.json(
      {
        error: `This book is about ${words.toLocaleString()} words — too long for a one-pass revision (the limit is ${REVISE_WORD_CAP.toLocaleString()}). Try revising a shorter book, or split it first.`,
      },
      { status: 400 }
    );
  }

  const a = src.analysis || {};

  return ndjsonResponse(async (send) => {
    const onDelta = (d) => send({ t: "delta", d });

    const rewritten = await reviseManuscript({
      title: src.title,
      author: src.author,
      guide: src.guide,
      mode: src.mode,
      fullText: fullTextWithChapters(src), // convey the chapter structure
      critique: a.critique,
      quality: a.quality,
      score: a.qualityScore,
      onDelta,
    });
    send({ t: "generated" });

    // Fork: a brand-new book (the original is untouched) built from the rewrite.
    let fork = newBook({
      title: `${src.title} — Revision`,
      author: src.author,
      mode: src.mode,
      settings: src.settings,
      guide: src.guide,
    });
    fork.arc = (src.arc || []).map((h) => ({ ...h, bornTurns: 0 }));
    fork = mergeFullText(fork, rewritten);
    fork.ended = true; // a finished revision

    // Re-score the rewrite honestly with the unchanged final evaluation.
    try {
      const analysis = await analyzeStory({
        title: fork.title,
        fullText: fullManuscript(fork),
        prior: null,
        guide: fork.mode === "guide",
        arc: fork.arc,
        sections: sectionCount(fork),
        final: true,
      });
      if (analysis) fork.analysis = analysis;
    } catch {
      // keep the blank analysis if the re-score fails (e.g. no API key)
    }

    await saveBook(fork);
    send({ t: "done", book: publicBook(fork), forkId: fork.id });
  });
}
