// ============================================================================
// providers.js — every model reference and every outbound call, in one place.
//
// Nothing else in the app names a model, holds an API host, or opens a network
// connection. To change where the writing comes from, or to audit what can
// leave this machine, this is the only file to read:
//
//   1. THE TOGGLE        online (Claude + cloud services) or offline (local model)
//   2. MODELS            which model plays which role, and what each accepts
//   3. COMPLETIONS       complete() / runText() — the one door every prompt uses
//   4. CLAUDE            the Anthropic transport (online)
//   5. LOCAL MODEL       the loopback OpenAI-compatible transport (offline)
//   6. SPEECH            ElevenLabs text-to-speech (online only)
//   7. TABLET SYNC       reMarkable cloud (online only)
//   8. CLOUD STORAGE     Upstash Redis client (online only)
//   9. BROWSER POLICY    the offline Content-Security-Policy
//
// Uses relative imports only, so it also loads from next.config and scripts.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import net from "node:net";
import { randomUUID } from "node:crypto";
import * as localStore from "./local-store.js";

// ---- 1. THE TOGGLE ----------------------------------------------------------
// The default for this repository. `true` = offline: prose comes from a model
// on this computer, books live in a local SQLite file, and every cloud service
// below refuses to run. `false` = online: Claude, plus whichever cloud services
// have credentials. Flip it here, or override per run without editing the file:
// LOOM_OFFLINE=1 forces offline, LOOM_OFFLINE=0 forces online.
const OFFLINE_DEFAULT = false;

export const offline =
  process.env.LOOM_OFFLINE === "1" ? true : process.env.LOOM_OFFLINE === "0" ? false : OFFLINE_DEFAULT;

// Per-book defaults that follow the toggle: a local model costs nothing per
// call, so offline starts with the two quality passes on; online they stay
// opt-in because each roughly doubles a section's cost.
export const QUALITY_DEFAULTS = offline ? { selfEdit: true, bestOfTwo: true } : {};

// Cookies may only be marked Secure when served over HTTPS; the offline app is
// plain http on loopback.
export const secureCookies = !offline && process.env.NODE_ENV === "production";

// The address `npm start` binds: loopback only when offline, so the library is
// never reachable from the network.
export const bindHost = offline ? "127.0.0.1" : "";

// ---- 2. MODELS --------------------------------------------------------------
// Three roles. Online each is a Claude model id, overridable by env var; offline
// each is a role name the local transport resolves to an installed model.
//   prose     — drafting, polish, rewrites        (CLAUDE_MODEL)
//   analysis  — review, planning, summaries        (CLAUDE_ANALYSIS_MODEL)
//   revision  — the whole-book revision passes     (CLAUDE_REVISE_MODEL)
export const MODEL = offline ? "local:prose" : process.env.CLAUDE_MODEL || "claude-opus-4-8";
export const ANALYSIS_MODEL = offline
  ? "local:analysis"
  : process.env.CLAUDE_ANALYSIS_MODEL || "claude-sonnet-4-6";
export const REVISE_MODEL = offline ? "local:revision" : process.env.CLAUDE_REVISE_MODEL || MODEL;

// Opus 4.7+, Sonnet 5+, Fable, and Mythos reject a custom temperature/top_p/top_k
// (HTTP 400). Only attach a temperature for models that accept one, so a model
// swap via env var can't 400 every request.
function rejectsSampling(model) {
  return /claude-(opus-4-[789]|opus-[5-9]|sonnet-[5-9]|fable|mythos)/.test(model || "");
}
export function tuned(params, temperature) {
  return rejectsSampling(params.model) ? params : { ...params, temperature };
}

// Adaptive thinking is available on Opus 4.6+, Sonnet 4.6+, Fable, and Mythos.
// Used only on the DIAGNOSTIC calls (analysis, revision planning, the beat
// planner) — never on prose drafting, where deliberation flattens the voice.
// Thinking is incompatible with a custom temperature, so it's stripped; and
// thinking tokens count toward max_tokens, so callers must leave headroom.
function supportsAdaptiveThinking(model) {
  return /claude-(opus-4-[6-9]|opus-[5-9]|sonnet-4-6|sonnet-[5-9]|fable|mythos)/.test(model || "");
}
export function withThinking(params, effort = "medium") {
  if (!supportsAdaptiveThinking(params.model)) return params;
  const { temperature, ...rest } = params;
  return { ...rest, thinking: { type: "adaptive" }, output_config: { effort } };
}

// The smallest prompt prefix worth marking for caching (4096 tokens on Opus —
// roughly 16k characters); below it the marker is silently ignored.
export const CACHE_MIN_CHARS = 20000;

// What to tell the author when the provider can't be reached at all.
export function providerErrorMessage(err, fallback) {
  return err && err.code === "NO_API_KEY" ? "The server is missing ANTHROPIC_API_KEY." : fallback;
}

// ---- 3. COMPLETIONS ---------------------------------------------------------
// Every prompt in the app goes through one of these two. `params` is an
// Anthropic Messages request ({ model, system, messages, max_tokens, ... });
// the local transport translates it. Both return the reply's text.

// Run a completion. If `onDelta` is provided, stream the model's text and call
// it with each chunk as it arrives; otherwise do a single blocking call.
export async function runText(params, onDelta) {
  if (offline) return localCompletion(params, onDelta);
  if (typeof onDelta !== "function") {
    const res = await claude().messages.create(params);
    return joinText(res.content);
  }
  const stream = claude().messages.stream(params);
  let text = "";
  stream.on("text", (delta) => {
    text += delta;
    try {
      onDelta(delta);
    } catch {}
  });
  const final = await stream.finalMessage();
  return joinText(final.content) || text.trim();
}

// A single blocking completion.
export function complete(params) {
  return runText(params);
}

// ---- 4. CLAUDE (online) -----------------------------------------------------
function claude() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY is not set on the server.");
    err.code = "NO_API_KEY";
    throw err;
  }
  return new Anthropic({ apiKey });
}

function joinText(blocks) {
  return (blocks || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ---- 5. LOCAL MODEL (offline) -----------------------------------------------
// An OpenAI-compatible server on this computer (llama.cpp and friends).
//   LOCAL_AI_BASE_URL       default http://127.0.0.1:8080/v1 — loopback only
//   LOCAL_AI_MODEL          the model used when no role has been chosen
//   LOCAL_AI_<ROLE>_MODEL   per-role override (PROSE / ANALYSIS / REVISION)
//   LOCAL_AI_TIMEOUT_MS     per-request ceiling (default 30 minutes)
//   LOCAL_AI_CATALOG        JSON list of installed models (the Windows launcher)
//   LOCAL_AI_LAUNCHER_LOG   the launcher's event log, read for load failures
export const localModel = process.env.LOCAL_AI_MODEL || "qwen36-huihui";
const LOCAL_ROLES = ["prose", "analysis", "revision"];
const LOCAL_ROLES_KEY = "local:models";
const LAUNCHER_PORT = 18097;

export function localBaseURL() {
  const url = new URL(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:8080/v1");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("Offline AI must use a loopback address on this computer.");
  }
  return url.href.replace(/\/$/, "");
}

// Which installed model plays each role (chosen in Admin, stored locally).
export function localRoles() {
  const saved = localStore.get(LOCAL_ROLES_KEY) || {};
  return { prose: localModel, analysis: localModel, revision: localModel, ...saved };
}
export function setLocalRoles(body, models) {
  const ids = new Set(models.map((m) => m.id));
  const roles = {};
  for (const role of LOCAL_ROLES) {
    if (!ids.has(body[role])) throw new Error(`Choose an installed model for ${role}.`);
    roles[role] = body[role];
  }
  localStore.set(LOCAL_ROLES_KEY, roles);
  return roles;
}

export function textContent(content) {
  return typeof content === "string"
    ? content
    : (content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
}

// Keep requests serial: the local router holds one large model at a time, while
// chapter summaries/cold reads may be requested concurrently by the app.
const queue = (globalThis.__LOOM_AI_QUEUE__ ||= { tail: Promise.resolve() });
export async function localCompletion(params, onDelta) {
  const previous = queue.tail;
  let release;
  queue.tail = new Promise((r) => {
    release = r;
  });
  await previous;
  try {
    return await localRequest(params, onDelta);
  } finally {
    release();
  }
}

async function localRequest(params, onDelta) {
  const base = localBaseURL();
  const roles = localStore.get(LOCAL_ROLES_KEY) || {};
  const role = params.model.replace(/^local:/, "");
  const model = roles[role] || process.env[`LOCAL_AI_${role.toUpperCase()}_MODEL`] || localModel;
  const catalog = installedModels();
  const selected = catalog?.find((m) => m.id === model);
  if (catalog) {
    if (!selected) throw new Error("Select an installed prose model in Admin.");
    const status = await modelStatus();
    if (!status.loaded.includes(model))
      throw new Error(
        "The selected writing model is not loaded. Open Admin and click Load selected model; wait for Ready."
      );
  }
  const messages = [
    ...(params.system ? [{ role: "system", content: textContent(params.system) }] : []),
    ...params.messages.map((m) => ({ role: m.role, content: textContent(m.content) })),
  ];
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(Number(process.env.LOCAL_AI_TIMEOUT_MS || 1800000)),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: selected ? Math.min(params.max_tokens || selected.max_output, selected.max_output) : params.max_tokens,
      temperature: params.temperature ?? 0.6,
      stream: true,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1500);
    throw new Error(`Local AI (${response.status}): ${detail}. Check the model and its context size in Local AI Chat.`);
  }
  let text = "",
    pending = "",
    finished = false,
    reason = "";
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  const consume = (line) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (raw === "[DONE]") {
      finished = true;
      return;
    }
    if (!raw) return;
    const event = JSON.parse(raw);
    if (event.error) throw new Error(event.error.message || JSON.stringify(event.error));
    const choice = event.choices?.[0];
    if (choice?.finish_reason) {
      reason = choice.finish_reason;
      finished = true;
    }
    const delta = choice?.delta?.content;
    if (delta) {
      text += delta;
      onDelta?.(delta);
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) consume(line);
      if (done) {
        if (pending) consume(pending);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!finished) throw new Error("Local AI stream interrupted; the incomplete passage was not saved.");
  if (reason === "length")
    throw new Error("Local AI reached its output/context limit; increase the context size or request a shorter passage.");
  if (!text.trim()) throw new Error("Local AI returned no text. Check the selected model.");
  return text.trim();
}

// The models installed on this machine, from the launcher's catalog (null when
// there is no catalog — then the server's own /models list is the source).
export function installedModels() {
  if (!process.env.LOCAL_AI_CATALOG) return null;
  return JSON.parse(readFileSync(process.env.LOCAL_AI_CATALOG, "utf8")).filter((m) => existsSync(m.path));
}

// Ask the local server which models it is serving.
export async function serverModels() {
  const res = await fetch(`${localBaseURL()}/models`, {
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
    redirect: "error",
  });
  if (!res.ok) throw new Error(`Local AI returned ${res.status}`);
  return (await res.json()).data || [];
}

const loads = (globalThis.__LOOM_MODEL_LOAD__ ||= { current: null });
function loadFailure() {
  const request = loads.current,
    log = process.env.LOCAL_AI_LAUNCHER_LOG;
  if (!request || !log || !existsSync(log)) return {};
  const length = statSync(log).size - request.offset;
  if (length <= 0) return {};
  const bytes = Buffer.alloc(Math.min(length, 65536));
  const fd = openSync(log, "r");
  try {
    readSync(fd, bytes, 0, bytes.length, request.offset);
  } finally {
    closeSync(fd);
  }
  for (const line of bytes.toString("utf8").split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.model === request.id && event.kind === "headroom_rejected")
        return {
          loadError:
            "The Local AI launcher stopped this load to preserve desktop GPU memory. Choose a smaller model or check the launcher.",
          failedModel: request.id,
        };
    } catch {}
  }
  return {};
}

export async function modelStatus() {
  try {
    const r = await fetch(`${localBaseURL()}/models`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
      redirect: "error",
    });
    if (!r.ok) return { ready: false, loaded: [], ...loadFailure() };
    const data = await r.json();
    return { ready: true, loaded: (data.data || []).map((m) => m.id) };
  } catch {
    return { ready: false, loaded: [], ...loadFailure() };
  }
}

// Ask the launcher to load a model (it holds one at a time).
export async function loadModel(id) {
  const model = installedModels()?.find((m) => m.id === id);
  if (!model) throw new Error("Choose an installed prose model.");
  const status = await modelStatus();
  if (status.loaded.includes(id)) return;
  if (status.ready) {
    const r = await fetch(`${localBaseURL().replace(/\/v1$/, "")}/slots`, {
      signal: AbortSignal.timeout(3000),
      redirect: "error",
    });
    if (!r.ok) throw new Error("Cannot verify that the model is idle.");
    if ((await r.json()).some((s) => s.is_processing))
      throw new Error("The current model is generating. Wait for it to finish before switching.");
  }
  const log = process.env.LOCAL_AI_LAUNCHER_LOG;
  loads.current = { id, offset: log && existsSync(log) ? statSync(log).size : 0 };
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: LAUNCHER_PORT });
    socket.setTimeout(3000);
    socket.on("connect", () => socket.end(model.mode));
    socket.on("close", (hadError) => {
      if (!hadError) resolve();
    });
    socket.on("error", () => reject(new Error("Open the Local AI launcher, then click Load again.")));
    socket.on("timeout", () => socket.destroy(new Error("Local AI launcher did not respond.")));
  });
}

// ---- A shared error for the cloud services below ----------------------------
export class ServiceError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status || 0;
    this.code = code || "service";
  }
}

// ---- 6. SPEECH (online only) ------------------------------------------------
// ElevenLabs text-to-speech, for read-aloud and audiobook export. The key stays
// on the server.  ELEVENLABS_API_KEY · ELEVENLABS_VOICE_ID · ELEVENLABS_MODEL_ID
const SPEECH_HOST = "https://api.elevenlabs.io";

export function speechConfigured() {
  return !offline && Boolean(process.env.ELEVENLABS_API_KEY);
}

// Synthesize one request's worth of text (≤ ~5k characters) to MP3 bytes.
// Throws ServiceError with code "offline" | "no_key" | "unreachable" | "failed".
export async function synthesizeSpeech(text, { failMessage = "Text-to-speech failed." } = {}) {
  if (offline) throw new ServiceError("Cloud narration is unavailable offline.", 503, "offline");
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ServiceError("The server is missing ELEVENLABS_API_KEY.", 503, "no_key");
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // default: "Rachel"
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
  let res;
  try {
    res = await fetch(`${SPEECH_HOST}/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
    });
  } catch {
    throw new ServiceError("Could not reach the text-to-speech service.", 502, "unreachable");
  }
  if (!res.ok) {
    let msg = failMessage;
    try {
      const j = await res.json();
      const detail = (j.detail && (j.detail.message || j.detail)) || j.message;
      if (typeof detail === "string") msg = detail;
    } catch {}
    throw new ServiceError(msg, res.status === 401 ? 401 : 502, "failed");
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---- 7. TABLET SYNC (online only) -------------------------------------------
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
const RM_AUTH_HOST = process.env.REMARKABLE_AUTH_HOST || "https://webapp-prod.cloud.remarkable.engineering";
const RM_DOC_HOST = process.env.REMARKABLE_DOC_HOST || "https://internal.cloud.remarkable.com";

export class RemarkableError extends ServiceError {
  constructor(message, status, code) {
    super(message, status, code || "remarkable");
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
  if (offline)
    throw new RemarkableError(
      "Cloud pairing is unavailable offline. Export EPUB or PDF and transfer it by USB.",
      503,
      "offline"
    );
  const clean = String(code || "").trim().toLowerCase();
  if (!/^[a-z0-9]{6,12}$/.test(clean)) {
    throw new RemarkableError("That doesn't look like a pairing code.", 400, "bad_code");
  }
  const deviceId = randomUUID();
  const res = await fetch(`${RM_AUTH_HOST}/token/json/2/device/new`, {
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
  const res = await fetch(`${RM_AUTH_HOST}/token/json/2/user/new`, {
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
  if (offline)
    throw new RemarkableError(
      "Cloud sync is unavailable offline. Export EPUB or PDF and transfer it by USB.",
      503,
      "offline"
    );
  const token = await userToken(deviceToken);
  const meta = Buffer.from(JSON.stringify({ file_name: String(name || "Untitled").slice(0, 120) })).toString(
    "base64"
  );
  const res = await fetch(`${RM_DOC_HOST}/doc/v2/files`, {
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

// ---- 8. CLOUD STORAGE (online only) -----------------------------------------
// Upstash Redis (the storage Vercel KV migrated to) injects REST credentials as
// env vars. Vercel's integration uses KV_REST_API_*, a direct Upstash project
// uses UPSTASH_REDIS_REST_*; accept either. Offline, books never leave the
// local SQLite file and this client is never constructed.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasCloudStore = !offline && Boolean(KV_URL && KV_TOKEN);

let _redis = null;
export function cloudStore() {
  if (!hasCloudStore) throw new Error("Cloud storage is not configured.");
  if (!_redis) _redis = new Redis({ url: KV_URL, token: KV_TOKEN });
  return _redis;
}

// ---- 9. BROWSER POLICY ------------------------------------------------------
// Offline, the browser itself is forbidden from loading or contacting anything
// that is not this server. Online, no policy is set.
export const contentSecurityPolicy = offline
  ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'"
  : "";
