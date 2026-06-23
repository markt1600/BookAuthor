import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import {
  mergeFullText,
  fullManuscript,
  chunkSourceText,
  sectionCount,
} from "@/lib/book";
import { reviseChunk, analyzeStory } from "@/lib/claude";
import { ndjsonResponse } from "@/lib/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const lastWords = (text, n) => {
  const w = String(text || "").trim().split(/\s+/);
  return w.length <= n ? w.join(" ") : w.slice(-n).join(" ");
};

export async function POST(request, { params }) {
  const { id } = await params; // the fork's id
  const fork = await getBook(id);
  if (!fork) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  if (!fork.revisionOf || typeof fork.revisionTotal !== "number") {
    return NextResponse.json({ error: "This is not a revision in progress." }, { status: 400 });
  }
  if (fork.revisionDone >= fork.revisionTotal) {
    return NextResponse.json({ complete: true, forkId: fork.id });
  }
  const src = await getBook(fork.revisionOf);
  if (!src) return NextResponse.json({ error: "The original book is gone." }, { status: 404 });

  const idx = fork.revisionDone;
  const chunk = fork.revisionChunks[idx];
  const chunkText = chunkSourceText(src, chunk.start, chunk.end);
  const isFirst = idx === 0;
  const isLast = idx === fork.revisionTotal - 1;

  return ndjsonResponse(async (send) => {
    const onDelta = (d) => send({ t: "delta", d });

    // Send the original chunk (prose only) so the client can show a live diff.
    const srcProse = chunkText.replace(/^[ \t]*##[ \t]+chapter\b.*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();
    send({ t: "source", text: srcProse });

    const rewritten = await reviseChunk({
      title: src.title,
      author: src.author,
      guide: src.guide,
      mode: src.mode,
      plan: fork.revisionPlan,
      synopsis: fork.revisionSynopsis,
      priorTail: lastWords(fork.revisionText, 800),
      chunkText,
      isFirst,
      isLast,
      onDelta,
    });
    send({ t: "generated" });

    fork.revisionText = (fork.revisionText ? fork.revisionText + "\n\n" : "") + rewritten.trim();
    fork.revisionDone = idx + 1;

    if (fork.revisionDone >= fork.revisionTotal) {
      // Last part — assemble the finished revision, end it, and re-score honestly.
      let done = mergeFullText(fork, fork.revisionText);
      done.ended = true;
      delete done.revisionOf;
      delete done.revisionPlan;
      delete done.revisionSynopsis;
      delete done.revisionChunks;
      delete done.revisionTotal;
      delete done.revisionDone;
      delete done.revisionText;
      try {
        const analysis = await analyzeStory({
          title: done.title,
          fullText: fullManuscript(done),
          prior: null,
          guide: done.mode === "guide",
          arc: done.arc,
          sections: sectionCount(done),
          final: true,
        });
        if (analysis) done.analysis = analysis;
      } catch {
        // keep blank analysis if the re-score fails
      }
      await saveBook(done);
      send({ t: "done", complete: true, forkId: done.id });
    } else {
      await saveBook(fork);
      send({ t: "done", complete: false, done: fork.revisionDone, total: fork.revisionTotal });
    }
  });
}
