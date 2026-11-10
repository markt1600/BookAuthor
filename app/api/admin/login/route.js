import { NextResponse } from "next/server";
import { secureCookies } from '@/lib/admin';
import { adminConfigured, checkPassword, adminToken, ADMIN_COOKIE } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!adminConfigured()) {
    // No password set — admin is open, nothing to log into.
    return NextResponse.json({ ok: true, configured: false });
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (!checkPassword(body.password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  });
  return res;
}

// Log out: clear the cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
