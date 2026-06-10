import { NextResponse } from "next/server";
import { adminConfigured, isAuthed } from "@/lib/admin";

export const dynamic = "force-dynamic";

export function GET(request) {
  return NextResponse.json({ configured: adminConfigured(), authed: isAuthed(request) });
}
