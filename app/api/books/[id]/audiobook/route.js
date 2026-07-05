import { NextResponse } from "next/server";
import { getBook } from "@/lib/store";
import { chapterText } from "@/lib/book";
import { bookUnlocked } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A chapter is synthesized in sentence-boundary chunks (ElevenLabs caps a
// request around 5k chars) and the MP3 segments are concatenated — same codec
// settings throughout, so byte-level concatenation plays cleanly.
const CHUNK_CHARS = 4200;
const MAX_CHAPTER_CHARS = 120000; // ~20k words — keep one request's work bounded

function chunkText(text) {
  const chunks = [];
  let cur = "";
  // Split on paragraph, then sentence boundaries; never mid-sentence.
  const paras = String(text).split(/\n{2,}/);
  const pieces = [];
  for (const p of paras) {
    if (p.length <= CHUNK_CHARS) pieces.push(p);
    else pieces.push(...p.split(/(?<=[.!?…”"])\s+/));
  }
  for (const piece of pieces) {
    if (!piece.trim()) continue;
    if (cur && cur.length + piece.length + 2 > CHUNK_CHARS) {
      chunks.push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// GET /api/books/[id]/audiobook?chapter=N — one chapter as a downloadable MP3.
export async function GET(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Audiobook export isn't configured — the server is missing ELEVENLABS_API_KEY." },
      { status: 503 }
    );
  }

  const chapterIndex = parseInt(new URL(request.url).searchParams.get("chapter") || "", 10);
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
    return NextResponse.json({ error: "Pass a chapter number." }, { status: 400 });
  }
  const text = chapterText(book, chapterIndex);
  if (!text) return NextResponse.json({ error: "That chapter has no text." }, { status: 404 });
  if (text.length > MAX_CHAPTER_CHARS) {
    return NextResponse.json(
      { error: "This chapter is too long for a single export — split it into two chapters first." },
      { status: 413 }
    );
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // default: "Rachel"
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";

  const segments = [];
  for (const chunk of chunkText(text)) {
    let res;
    try {
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: chunk,
          model_id: modelId,
          voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
        }),
      });
    } catch {
      return NextResponse.json({ error: "Could not reach the text-to-speech service." }, { status: 502 });
    }
    if (!res.ok) {
      let msg = "Text-to-speech failed part-way through the chapter.";
      try {
        const j = await res.json();
        const detail = (j.detail && (j.detail.message || j.detail)) || j.message;
        if (typeof detail === "string") msg = detail;
      } catch {}
      return NextResponse.json({ error: msg }, { status: res.status === 401 ? 401 : 502 });
    }
    segments.push(Buffer.from(await res.arrayBuffer()));
  }

  const audio = Buffer.concat(segments);
  const slug = (book.title || "book")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "book";
  const num = String(chapterIndex + 1).padStart(2, "0");
  return new Response(audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Disposition": `attachment; filename="${slug}-chapter-${num}.mp3"`,
      "Cache-Control": "no-store",
    },
  });
}
