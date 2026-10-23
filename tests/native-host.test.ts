import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let connect: (port: chrome.runtime.Port) => void;
let response: (message: unknown) => void;
let gate: (() => void) | undefined;
const sent = vi.fn();
const port = () => ({ name: 'readside-native', sender: { id: 'reader', url: 'chrome-extension://reader/offscreen.html' }, postMessage: sent, onMessage: { addListener: (fn: typeof response) => { response = fn; } }, onDisconnect: { addListener() {} } }) as unknown as chrome.runtime.Port;
const sender = { id: 'reader', url: 'https://example.com/article', tab: { id: 5 }, frameId: 0, documentId: 'document-one' } as chrome.runtime.MessageSender;
const request = { type: 'PR_NATIVE', request: 'request-one', client: 'generation-one', op: 'translate', source: 'en', target: 'zh', text: 'Read a useful idea.' };
beforeEach(() => {
  vi.resetModules(); sent.mockClear(); gate = undefined;
  vi.stubGlobal('chrome', {
    runtime: { id: 'reader', getURL: (path: string) => `chrome-extension://reader/${path}`, onConnect: { addListener: (fn: typeof connect) => { connect = fn; } }, ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }, getContexts: async () => [] },
    tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    offscreen: { Reason: { WORKERS: 'WORKERS' }, createDocument: () => new Promise<void>(resolve => { gate = () => { connect(port()); resolve(); }; }) },
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('extension-internal native RPC', () => {
  it('rejects untrusted senders, subframes and unbounded input', async () => {
    const { nativeMessage } = await import('../src/background/native-host'); const reply = vi.fn();
    for (const invalid of [{ ...sender, id: 'other' }, { ...sender, frameId: 1 }, { ...sender, documentId: undefined }, { ...sender, url: 'http://external.example/' }, { ...sender, url: 'http://localhost:80@evil.example/' }, { ...sender, url: 'chrome-extension://reader/options.html' }]) expect(nativeMessage(request, invalid, reply)).toBe(false);
    expect(nativeMessage({ ...request, text: 'x'.repeat(4001) }, sender, reply)).toBe(false);
    expect(nativeMessage({ ...request, source: 'unknown' }, sender, reply)).toBe(false);
    expect(reply).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
  });
  it('accepts only the exact offscreen origin and isolates each document generation', async () => {
    const { nativeMessage } = await import('../src/background/native-host'); const reply = vi.fn();
    nativeMessage(request, sender, reply); await vi.waitFor(() => expect(gate).toBeTypeOf('function'));
    connect({ ...port(), sender: { id: 'reader', url: 'https://example.com/offscreen.html' } } as chrome.runtime.Port);
    expect(sent).not.toHaveBeenCalled(); gate!();
    await vi.waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(sent.mock.calls[0]![0]).toMatchObject({ type: 'submit', job: { owner: 'document-one:generation-one', id: 'document-one:request-one' } });
    response({ type: 'result', id: 'document-one:request-one', response: { ok: true, value: '译文' } }); expect(reply).toHaveBeenCalledWith({ ok: true, value: '译文' });
  });
  it('cancels a request while the offscreen connection is still starting', async () => {
    const { nativeMessage } = await import('../src/background/native-host'); const reply = vi.fn();
    nativeMessage(request, sender, reply);
    nativeMessage({ ...request, type: 'PR_NATIVE_CANCEL' }, sender, vi.fn());
    await vi.waitFor(() => expect(gate).toBeTypeOf('function')); gate!();
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: false, name: 'AbortError' }));
    expect(sent).not.toHaveBeenCalled();
  });
});
