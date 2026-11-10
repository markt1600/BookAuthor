import { NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Server-side proxy to the speech provider so the API key is never exposed to
// the browser. POST { text } -> audio/mpeg bytes.
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  let text = String(body.text || "").trim();
  if (!text) return NextResponse.json({ error: "Nothing to read." }, { status: 400 });
  if (text.length > 5000) text = text.slice(0, 5000); // stay within request limits

  let buf;
  try {
    buf = await synthesizeSpeech(text);
  } catch (err) {
    const error =
      err.code === "offline"
        ? "Cloud narration is unavailable offline. Use the device voice if installed."
        : err.code === "no_key"
        ? "Read-aloud isn't configured — the server is missing its text-to-speech key."
        : err.message || "Text-to-speech failed.";
    return NextResponse.json({ error }, { status: err.code === "no_key" ? 500 : err.status || 502 });
  }
  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
