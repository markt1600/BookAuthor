import { randomUUID } from "crypto";
import { offline } from './local-config.js';

// Minimal reMarkable Cloud client — just enough to pair Loom with an account
// once and push the current book (as an EPUB) straight to the tablet.
//
// This speaks the same public integration surface as reMarkable's own
// "Read on reMarkable" browser extension and tools like rmapi:
//   1. A one-time code from https://my.remarkable.com (Pair a device → browser)
//      is exchanged for a long-lived DEVICE token. Stored server-side.
//   2. Each send, the device token is exchanged for a short-lived USER token.
//   3. The document bytes are POSTed to the doc endpoint; the reMarkable cloud
//      then syncs it to every device on the account (e.g. a Paper Pro).
//
// Hosts are env-overridable in case reMarkable migrates its endpoints:
//   REMARKABLE_AUTH_HOST (token exchange) · REMARKABLE_DOC_HOST (upload)
const AUTH_HOST =
  process.env.REMARKABLE_AUTH_HOST || "https://webapp-prod.cloud.remarkable.engineering";
const DOC_HOST = process.env.REMARKABLE_DOC_HOST || "https://internal.cloud.remarkable.com";

export class RemarkableError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status || 0;
    this.code = code || "remarkable";
  }
}

async function readBody(res) {
  try {
    return (await res.text()).trim();
  } catch {
    return "";
  }
}

// Exchange the one-time pairing code for a long-lived device token.
export async function pairDevice(code) {
  if (offline) throw new RemarkableError('Cloud pairing is unavailable offline. Export EPUB or PDF and transfer it by USB.',503,'offline');
  const clean = String(code || "").trim().toLowerCase();
  if (!/^[a-z0-9]{6,12}$/.test(clean)) {
    throw new RemarkableError("That doesn't look like a pairing code.", 400, "bad_code");
  }
  const deviceId = randomUUID();
  const res = await fetch(`${AUTH_HOST}/token/json/2/device/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer" },
    body: JSON.stringify({ code: clean, deviceDesc: "browser-chrome", deviceID: deviceId }),
  });
  const body = await readBody(res);
  if (!res.ok || !body) {
    throw new RemarkableError(
      res.status === 400 || res.status === 401
        ? "reMarkable rejected the code — codes expire quickly, so grab a fresh one and try again."
        : `reMarkable pairing failed (HTTP ${res.status}).`,
      res.status,
      "pair_failed"
    );
  }
  // The response is the raw device-token JWT as text.
  return { deviceToken: body, deviceId, pairedAt: Date.now() };
}

// Exchange the stored device token for a short-lived user token.
async function userToken(deviceToken) {
  const res = await fetch(`${AUTH_HOST}/token/json/2/user/new`, {
    method: "POST",
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  const body = await readBody(res);
  if (!res.ok || !body) {
    throw new RemarkableError(
      res.status === 401
        ? "reMarkable no longer accepts this pairing — re-pair with a fresh code."
        : `Could not refresh the reMarkable session (HTTP ${res.status}).`,
      res.status,
      res.status === 401 ? "unpaired" : "token_failed"
    );
  }
  return body;
}

// Upload an EPUB to the account's cloud library; devices sync it automatically.
export async function sendEpub({ deviceToken, name, buf }) {
  if (offline) throw new RemarkableError('Cloud sync is unavailable offline. Export EPUB or PDF and transfer it by USB.',503,'offline');
  const token = await userToken(deviceToken);
  const meta = Buffer.from(JSON.stringify({ file_name: String(name || "Untitled").slice(0, 120) })).toString(
    "base64"
  );
  const res = await fetch(`${DOC_HOST}/doc/v2/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/epub+zip",
      "rm-meta": meta,
      "rm-source": "RoR-Browser",
    },
    body: buf,
  });
  if (!res.ok) {
    const body = await readBody(res);
    throw new RemarkableError(
      res.status === 401
        ? "reMarkable no longer accepts this pairing — re-pair with a fresh code."
        : `reMarkable refused the upload (HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}).`,
      res.status,
      res.status === 401 ? "unpaired" : "upload_failed"
    );
  }
  return true;
}
