import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Server-side proxy to ElevenLabs so the API key is never exposed to the browser.
// POST { text } -> audio/mpeg bytes.
export async function POST(request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Read-aloud isn't configured — the server is missing ELEVENLABS_API_KEY." },
      { status: 500 }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  let text = String(body.text || "").trim();
  if (!text) return NextResponse.json({ error: "Nothing to read." }, { status: 400 });
  if (text.length > 5000) text = text.slice(0, 5000); // stay within request limits

  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // default: "Rachel"
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";

  let res;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the text-to-speech service." }, { status: 502 });
  }

  if (!res.ok) {
    let msg = "Text-to-speech failed.";
    try {
      const j = await res.json();
      msg = (j.detail && (j.detail.message || j.detail)) || j.message || msg;
      if (typeof msg !== "string") msg = "Text-to-speech failed.";
    } catch {}
    const status = res.status === 401 ? 401 : 502;
    return NextResponse.json({ error: msg }, { status });
  }

  const buf = await res.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
