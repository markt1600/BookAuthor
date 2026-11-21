import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import { newBook, fullManuscript, fullTextWithChapters, reviseParts, countWords, chapterDigest, manuscriptText } from "@/lib/book";
import { revisionPlan } from "@/lib/claude";
import { plannerLens } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";
import { providerErrorMessage, REVISE_PART_WORDS, REVISE_PLAN_WORDS } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  // The planner reads the whole book when it fits the model; a longer book is
  // read as its chapter-by-chapter digest plus the opening and the latest prose.
  const digest = chapterDigest(src);
  const planText =
    words <= REVISE_PLAN_WORDS
      ? fullTextWithChapters(src)
      : [
          digest ? `[The book is too long to show whole. Chapter by chapter:]\n${digest}` : "",
          `[Its opening and its latest pages:]\n${manuscriptText(src, Math.min(REVISE_PLAN_WORDS, 12000))}`,
        ]
          .filter(Boolean)
          .join("\n\n");
  let plan = "";
  try {
    plan = await revisionPlan({
      title: src.title,
      fullText: planText,
      critique: a.critique,
      quality: a.quality,
      score: a.qualityScore,
      ...plannerLens(src, { direction: "" }),
    });
  } catch (err) {
    const msg = providerErrorMessage(err, "Couldn't plan the revision. Try again.");
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const chunks = reviseParts(src, REVISE_PART_WORDS).map((text) => ({ text }));
  const fork = newBook({
    title: `${src.title} — Revision`,
    author: src.author,
    mode: src.mode,
    settings: src.settings,
    guide: src.guide,
  });
  fork.revisionOf = src.id;
  fork.brief = src.brief || null; // a revision is held to the same stated aims
  fork.revisionPlan = plan;
  fork.revisionSynopsis = a.synopsis || "";
  fork.revisionScore = typeof a.qualityScore === "number" ? a.qualityScore : null;
  fork.revisionChunks = chunks;
  fork.revisionTotal = chunks.length;
  fork.revisionDone = 0;
  fork.revisionText = "";
  await saveBook(fork);

  return NextResponse.json({ forkId: fork.id, total: chunks.length });
}
