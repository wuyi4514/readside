import { nativeAPIs, type NativeDetector, type NativeTranslator } from './native-types';
interface Session { owner: string; translator?: NativeTranslator; detector?: NativeDetector }
const sessions = new Map<string, Session>();
const jobs = new Map<string, AbortController>();
const worker = new Worker('native-worker.js', { type: 'module' });
let port: chrome.runtime.Port | undefined;
function connect(): void {
  if (port) return;
  const connection = chrome.runtime.connect({ name: 'readside-native' }); port = connection;
  connection.onMessage.addListener(message => worker.postMessage(message));
  connection.onDisconnect.addListener(() => { if (port === connection) port = undefined; for (const controller of jobs.values()) controller.abort(); });
}
connect();
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'PR_NATIVE_CONNECT' && sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('background.js')) connect();
});
function release(document: string): void {
  for (const [key, session] of sessions) if (session.owner.startsWith(document + ':')) { session.translator?.destroy(); session.detector?.destroy(); sessions.delete(key); }
}
worker.onmessage = event => {
  const message = event.data;
  if (message.type === 'result') { try { port?.postMessage(message); } catch { /* Worker restart drops its waiting clients. */ } return; }
  if (message.type === 'abort') { jobs.get(message.id)?.abort(); return; }
  if (message.type === 'release') { release(message.document); return; }
  if (message.type !== 'execute') return;
  const job = message.job; const controller = new AbortController(); jobs.set(job.id, controller);
  void execute(job, controller.signal).then(value => ({ ok: true, value }), error => ({ ok: false, name: String(error?.name ?? 'Error'), message: String(error?.message ?? 'Local engine failed') })).then(response => {
    jobs.delete(job.id); worker.postMessage({ type: 'completed', id: job.id, response });
  });
};
async function execute(job: { owner: string; op: string; source: string; target: string; text: string }, signal: AbortSignal): Promise<unknown> {
  const apis = nativeAPIs(); const key = `${job.owner}:${job.source}>${job.target}`;
  signal.throwIfAborted();
  if (job.op === 'availability') return apis.translator?.availability({ sourceLanguage: job.source, targetLanguage: job.target }) ?? 'unavailable';
  if (job.op === 'detector-availability') return apis.detector?.availability() ?? 'unavailable';
  if (job.op === 'open-translator') {
    if (!apis.translator) throw new DOMException('Unsupported browser', 'NotSupportedError');
    const translator = await apis.translator.create({ sourceLanguage: job.source, targetLanguage: job.target, signal });
    if (signal.aborted) { translator.destroy(); signal.throwIfAborted(); }
    sessions.get(key)?.translator?.destroy(); sessions.set(key, { owner: job.owner, translator }); return true;
  }
  if (job.op === 'open-detector') {
    if (!apis.detector) throw new DOMException('Unsupported browser', 'NotSupportedError');
    const detector = await apis.detector.create({ signal });
    if (signal.aborted) { detector.destroy(); signal.throwIfAborted(); }
    sessions.get(key)?.detector?.destroy(); sessions.set(key, { owner: job.owner, detector }); return true;
  }
  const session = sessions.get(key);
  if (job.op === 'close-translator' || job.op === 'close-detector') { session?.translator?.destroy(); session?.detector?.destroy(); sessions.delete(key); return true; }
  if (job.op === 'translate' && session?.translator) return session.translator.translate(job.text, { signal });
  if (job.op === 'detect' && session?.detector) return session.detector.detect(job.text, { signal });
  throw new DOMException('Session was released', 'InvalidStateError');
}
