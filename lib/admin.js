import crypto from "crypto";

export const ADMIN_COOKIE = "loom_admin";

// Admin protection is active only when ADMIN_PASSWORD is set in the environment.
export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

// The opaque cookie value we store once a visitor has authenticated. Derived
// from the password so we can verify it statelessly (no session store).
export function adminToken() {
  const pw = process.env.ADMIN_PASSWORD || "";
  return crypto.createHash("sha256").update(`loom:${pw}`).digest("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function checkPassword(pw) {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) return false;
  return safeEqual(pw, expected);
}

// True if the request is allowed to use admin endpoints. Open when no password
// is configured (preserves the original behavior); otherwise requires the cookie.
export function isAuthed(request) {
  if (!adminConfigured()) return true;
  const tok = request?.cookies?.get?.(ADMIN_COOKIE)?.value;
  if (!tok) return false;
  return safeEqual(tok, adminToken());
}
