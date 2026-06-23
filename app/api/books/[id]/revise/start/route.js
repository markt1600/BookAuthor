import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import { newBook, fullManuscript, fullTextWithChapters, reviseChunks, countWords } from "@/lib/book";
import { revisionPlan } from "@/lib/claude";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// A whole-book revision is rewritten in chunks; cap the total so the operation
// stays bounded in time and cost.
const REVISE_WORD_CAP = 50000;

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
        error: `This book is about ${words.toLocaleString()} words — beyond the ${REVISE_WORD_CAP.toLocaleString()}-word limit for an automated revision.`,
      },
      { status: 400 }
    );
  }

  const a = src.analysis || {};
  let plan = "";
  try {
    plan = await revisionPlan({
      title: src.title,
      fullText: fullTextWithChapters(src),
      critique: a.critique,
      quality: a.quality,
      score: a.qualityScore,
    });
  } catch (err) {
    const msg =
      err && err.code === "NO_API_KEY"
        ? "The server is missing ANTHROPIC_API_KEY."
        : "Couldn't plan the revision. Try again.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const chunks = reviseChunks(src, 3500);
  const fork = newBook({
    title: `${src.title} — Revision`,
    author: src.author,
    mode: src.mode,
    settings: src.settings,
    guide: src.guide,
  });
  fork.revisionOf = src.id;
  fork.revisionPlan = plan;
  fork.revisionSynopsis = a.synopsis || "";
  fork.revisionChunks = chunks;
  fork.revisionTotal = chunks.length;
  fork.revisionDone = 0;
  fork.revisionText = "";
  await saveBook(fork);

  return NextResponse.json({ forkId: fork.id, total: chunks.length });
}
