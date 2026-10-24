import { localBaseURL, localModel } from './local-config.js';
import { get } from './local-store.js';

export function textContent(content) {
  return typeof content === 'string' ? content : (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// Keep requests serial: the GPD router holds one large model at a time, while
// chapter summaries/cold reads may be requested concurrently by the app.
const state = globalThis.__LOOM_AI_QUEUE__ ||= { tail: Promise.resolve() };
export async function localCompletion(params, onDelta) {
  const previous = state.tail;
  let release;
  state.tail = new Promise(r => { release = r; });
  await previous;
  try { return await complete(params, onDelta); } finally { release(); }
}
async function complete(params, onDelta) {
  const base = localBaseURL();
  const roles = get('local:models') || {};
  const role = params.model.replace(/^local:/, '');
  const model = roles[role] || process.env[`LOCAL_AI_${role.toUpperCase()}_MODEL`] || localModel;
  const messages = [
    ...(params.system ? [{ role: 'system', content: textContent(params.system) }] : []),
    ...params.messages.map(m => ({ role: m.role, content: textContent(m.content) })),
  ];
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(Number(process.env.LOCAL_AI_TIMEOUT_MS || 1800000)),
    body: JSON.stringify({ model, messages, max_tokens: params.max_tokens,
      temperature: params.temperature ?? 0.6, stream: true,
      chat_template_kwargs: { enable_thinking: false } }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1500);
    throw new Error(`Local AI (${response.status}): ${detail}. Check the model and its context size in Local AI Chat.`);
  }
  let text = '', pending = '', finished = false, reason = '';
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const consume = line => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (raw === '[DONE]') { finished = true; return; }
    if (!raw) return;
    const event = JSON.parse(raw);
    if (event.error) throw new Error(event.error.message || JSON.stringify(event.error));
    const choice = event.choices?.[0];
    if (choice?.finish_reason) { reason = choice.finish_reason; finished = true; }
    const delta = choice?.delta?.content;
    if (delta) { text += delta; onDelta?.(delta); }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/); pending = lines.pop();
      for (const line of lines) consume(line);
      if (done) { if (pending) consume(pending); break; }
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!finished) throw new Error('Local AI stream interrupted; the incomplete passage was not saved.');
  if (reason === 'length') throw new Error('Local AI reached its output/context limit; increase the context size or request a shorter passage.');
  if (!text.trim()) throw new Error('Local AI returned no text. Check the selected model.');
  return text.trim();
}
