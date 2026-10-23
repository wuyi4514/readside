import { apiLanguage, LANGUAGES } from '../shared/settings';
const operations = new Set(['availability','detector-availability','open-translator','open-detector','translate','detect','close-translator','close-detector']);
const languages = new Set(LANGUAGES.map(l => apiLanguage(l.code)));
let port: chrome.runtime.Port | undefined;
let creating: Promise<void> | undefined;
let portReady: (() => void) | undefined;
const requests = new Map<string, { document: string; cancelled?: boolean; reply(value: unknown): void }>();
const documents = new Map<string, number>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;

chrome.runtime.onConnect.addListener(connection => {
  if (connection.name !== 'readside-native' || connection.sender?.id !== chrome.runtime.id || connection.sender.url !== chrome.runtime.getURL('offscreen.html')) return;
  port = connection; portReady?.(); portReady = undefined;
  connection.onMessage.addListener(message => {
    if (message.type !== 'result') return;
    const request = requests.get(message.id); if (!request) return;
    requests.delete(message.id); request.reply(message.response);
  });
  connection.onDisconnect.addListener(() => {
    if (port !== connection) return; port = undefined;
    for (const request of requests.values()) request.reply({ ok: false, name: 'AbortError', message: 'Engine restarted' }); requests.clear();
  });
});
async function ensure(): Promise<void> {
  if (port) return;
  creating ??= (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connected = new Promise<void>((resolve, reject) => { portReady = resolve; timer = setTimeout(() => reject(new Error('Engine connection timed out')), 10_000); });
    void connected.catch(() => undefined);
    try {
      const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
      if (!contexts.length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: '在扩展来源使用本地翻译 Window API，并由 Worker 排队、限制和取消各网页的翻译任务。' });
      else if (!port) await chrome.runtime.sendMessage({ type: 'PR_NATIVE_CONNECT' });
      await connected;
    } finally { clearTimeout(timer); }

  })().finally(() => { creating = undefined; });
  await creating;
}
export function nativeMessage(message: Record<string, unknown>, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void): boolean {
  if (sender.tab?.id === undefined || sender.frameId !== 0 || !sender.documentId || sender.id !== chrome.runtime.id || !sender.url || !supportedURL(sender.url)) return false;
  const document = sender.documentId;
  if (typeof message.request !== 'string' || message.request.length > 100 || typeof message.client !== 'string' || message.client.length > 100) return false;
  const id = `${document}:${message.request}`;
  if (message.type === 'PR_NATIVE_CANCEL') { const request = requests.get(id); if (request?.document === document) { request.cancelled = true; port?.postMessage({ type: 'cancel', id }); } reply({ ok: true }); return true; }
  if (!operations.has(String(message.op)) || typeof message.text !== 'string' || message.text.length > 4000 || typeof message.source !== 'string' || typeof message.target !== 'string') return false;
  if (message.source && (!languages.has(message.source) || !languages.has(message.target))) return false;
  clearTimeout(idleTimer); documents.set(document, sender.tab.id);
  const job = { id, owner: `${document}:${message.client}`, op: message.op, source: message.source, target: message.target, text: message.text };
  requests.set(id, { document, reply });
  void ensure().then(() => {
    const request = requests.get(id); if (!request) return;
    if (request.cancelled) { requests.delete(id); reply({ ok: false, name: 'AbortError' }); return; }
    port!.postMessage({ type: 'submit', job });
  }).catch(() => { requests.delete(id); reply({ ok: false, name: 'NotSupportedError', message: 'Local engine unavailable' }); });
  return true;
}
function release(document: string): void {
  port?.postMessage({ type: 'release', document }); documents.delete(document);
  for (const [id, request] of requests) if (request.document === document) { request.reply({ ok: false, name: 'AbortError' }); requests.delete(id); }
  if (!documents.size) { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!documents.size && !requests.size) void chrome.offscreen.closeDocument().catch(() => undefined); }, 20_000); }
}
chrome.tabs.onRemoved.addListener(tabId => { for (const [document, tab] of documents) if (tab === tabId) release(document); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'loading') for (const [document, tab] of documents) if (tab === tabId) release(document); });

function supportedURL(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)); }
  catch { return false; }
}
