import { NextResponse } from "next/server";
import { storageMode } from "@/lib/store";
import { offline, speechConfigured, QUALITY_DEFAULTS } from "@/lib/providers";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    storageMode,
    offline,
    tts: speechConfigured(),
    // Per-book setting defaults that follow the online/offline toggle.
    defaults: QUALITY_DEFAULTS,
  });
}
