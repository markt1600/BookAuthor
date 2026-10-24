// This branch is offline by default. Cloud credentials cannot silently enable
// outbound services; opting into the original deployment requires LOOM_OFFLINE=0.
export const offline = process.env.LOOM_OFFLINE !== "0";
export const localModel = process.env.LOCAL_AI_MODEL || "qwen36-huihui";
export function localBaseURL() {
  const url = new URL(process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:8080/v1");
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Offline AI must use a loopback address on this computer.');
  }
  return url.href.replace(/\/$/, '');
}
