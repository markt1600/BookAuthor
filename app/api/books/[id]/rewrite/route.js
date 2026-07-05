import { NextResponse } from "next/server";
import { getBook, saveBook, saveSnapshot, acquireLock, releaseLock } from "@/lib/store";
import { countWords, publicBook } from "@/lib/book";
import { rewritePassage } from "@/lib/claude";
import { refreshAnalysis, ndjsonResponse } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// How much surrounding text the model sees on each side of the passage.
const CONTEXT_WORDS = 600;

const tailOf = (text, n) => {
  const w = String(text).split(/\s+/).filter(Boolean);
  return w.length <= n ? text.trim() : "… " + w.slice(-n).join(" ");
};
const headOf = (text, n) => {
  const w = String(text).split(/\s+/).filter(Boolean);
  return w.length <= n ? text.trim() : w.slice(0, n).join(" ") + " …";
};

// Targeted rewrite: revise ONE passage in place per the author's instruction.
// Unlike "edit from here" (which forks and discards), the rest of the book is
// untouched — the rewrite must fit seamlessly between its neighbors. The prior
// version is snapshotted first, so it's reversible from History.
export async function POST(request, { params }) {
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
  const turnId = String(body.turnId || "");
  const instruction = String(body.instruction || "").trim();
  if (!instruction) {
    return NextResponse.json({ error: "Say how the passage should change first." }, { status: 400 });
  }
  const turns = book.turns || [];
  const idx = turns.findIndex((t) => t && t.id === turnId);
  if (idx < 0) {
    return NextResponse.json({ error: "That passage no longer exists." }, { status: 404 });
  }

  const lock = await acquireLock(id);
  if (!lock) {
    return NextResponse.json(
      { error: "The AI author is already writing — wait for the current job to finish." },
      { status: 409 }
    );
  }

  const priorAnalysis = book.analysis && book.analysis.updatedAt ? book.analysis : null;
  await saveSnapshot(book, "Before rewriting a passage");

  const before = turns
    .slice(0, idx)
    .map((t) => t.text)
    .join("\n\n");
  const after = turns
    .slice(idx + 1)
    .map((t) => t.text)
    .join("\n\n");

  return ndjsonResponse(async (send) => {
    try {
      const onDelta = (d) => send({ t: "delta", d });

      const rewritten = await rewritePassage({
        title: book.title,
        author: book.author,
        mode: book.mode,
        guide: book.guide,
        instruction,
        before: before ? tailOf(before, CONTEXT_WORDS) : "",
        passage: turns[idx].text,
        after: after ? headOf(after, CONTEXT_WORDS) : "",
        memory: priorAnalysis,
        bible: (book.bible || "").trim(),
        onDelta,
      });

      const clean = String(rewritten).replace(/\s+$/g, "");
      book.turns[idx] = {
        ...turns[idx],
        text: clean,
        words: countWords(clean),
        rewrittenAt: Date.now(),
      };

      await saveBook(book); // persist before the slower analysis call
      send({ t: "generated" });
      send({ t: "done", book: publicBook(book), addedTurnIds: [turnId] });

      await refreshAnalysis(book, priorAnalysis);
      const latest = (await getBook(id)) || book;
      latest.analysis = book.analysis;
      await saveBook(latest);
      send({ t: "analysis", analysis: latest.analysis });
    } finally {
      await releaseLock(id, lock);
    }
  });
}
