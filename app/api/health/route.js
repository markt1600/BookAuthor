import { NextResponse } from "next/server";
import { storageMode } from "@/lib/store";
import { offline } from '@/lib/local-config';

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    storageMode,
    offline,
    tts: !offline && Boolean(process.env.ELEVENLABS_API_KEY),
  });
}
