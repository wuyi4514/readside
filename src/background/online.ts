import { PROVIDER_ORIGINS, type Provider, type Settings } from '../shared/settings';

const jobs = new Map<string, AbortController>();
const language = (value: string, provider: Provider): string => value === 'zh-CN' && provider === 'microsoft' ? 'zh-Hans' : value;

async function request(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  const result = await fetch(url, { ...init, signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (!result.ok) throw new Error(result.status === 429 ? 'online_rate_limit' : 'online_unavailable');
  return result;
}
export async function translateOnline(provider: 'google' | 'microsoft', text: string, source: string, target: string, signal: AbortSignal): Promise<string> {
  let translated: unknown;
  if (provider === 'google') {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.search = new URLSearchParams({ client: 'gtx', sl: source, tl: target, dt: 't', q: text }).toString();
    const data: unknown = await (await request(url.href, signal)).json();
    if (Array.isArray(data) && Array.isArray(data[0]) && data[0].every((part: unknown) => Array.isArray(part) && typeof part[0] === 'string')) translated = data[0].map((part: string[]) => part[0]).join('');
  } else {
    const url = new URL('https://edge.microsoft.com/translate/translatetext');
    url.search = new URLSearchParams({ from: language(source, provider), to: language(target, provider), isEnterpriseClient: 'false' }).toString();
    const data: unknown = await (await request(url.href, signal, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([text]) })).json();
    if (Array.isArray(data)) translated = typeof data[0] === 'string' ? data[0] : data[0]?.translations?.[0]?.text;
  }
  if (typeof translated !== 'string' || !translated.trim() || translated.length > Math.max(4000, text.length * 8)) throw new Error('online_invalid_response');
  return translated.trim();
}

export function onlineMessage(message: Record<string, unknown>, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void, settings: () => Promise<Settings>): boolean | undefined {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0 || typeof message.request !== 'string' || message.request.length > 64) return;
  const key = `${sender.tab.id}:${sender.frameId}:${message.request}`;
  if (message.type === 'PR_ONLINE_CANCEL') { jobs.get(key)?.abort(); reply({ ok: true }); return; }
  if (message.type !== 'PR_ONLINE' || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4000 || jobs.has(key)) return;
  const controller = new AbortController(); jobs.set(key, controller);
  void (async () => {
    if (jobs.size > 32) throw new Error('online_busy');
    const current = await settings();
    if (current.provider === 'chrome-local' || message.provider !== current.provider) throw new Error('online_provider_changed');
    if (!await chrome.permissions.contains({ origins: PROVIDER_ORIGINS[current.provider] })) throw new Error('online_permission');
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    if (message.op === 'detect') {
      const result = await chrome.i18n.detectLanguage(message.text as string);
      return result.languages.map(item => ({ detectedLanguage: item.language, confidence: Math.min(item.percentage / 100, result.isReliable ? 1 : .5) }));
    }
    if (message.op !== 'translate' || !current.sourceLanguages.some(source => source === message.source) || message.target !== current.targetLanguage) throw new Error('online_invalid_request');
    return translateOnline(current.provider, message.text as string, message.source as string, current.targetLanguage, signal);
  })().then(value => reply({ ok: true, value }), error => reply({ ok: false, error: error instanceof Error ? error.message : 'online_failed' })).finally(() => jobs.delete(key));
  return true;
}
export function cancelOnlineTab(tabId: number): void { for (const [key, job] of jobs) if (key.startsWith(`${tabId}:`)) { job.abort(); jobs.delete(key); } }
