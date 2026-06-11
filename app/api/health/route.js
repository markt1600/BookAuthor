import { NextResponse } from "next/server";
import { storageMode } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    storageMode,
    tts: Boolean(process.env.ELEVENLABS_API_KEY),
  });
}
