import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../shared/settings';
import type { Message } from '../shared/messages';
import { isExtensionUI } from '../shared/sender';

const KEY = 'settings';
const SCRIPT_ID = 'parallel-read';
let writes: Promise<unknown> = Promise.resolve();

async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return sanitizeSettings(stored[KEY] ?? DEFAULT_SETTINGS);
}

function isUI(sender: chrome.runtime.MessageSender): boolean {
  return isExtensionUI(sender, chrome.runtime.id);
}

function hostPattern(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.protocol === 'http:')) return null;
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch { return null; }
}

async function permitted(url?: string): Promise<boolean> {
  const pattern = url && hostPattern(url);
  return pattern ? chrome.permissions.contains({ origins: [pattern] }) : false;
}

async function notify(settings: Settings): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(t => t.id !== undefined).map(async tab => {
    await chrome.tabs.sendMessage(tab.id!, { type: 'PR_SETTINGS', settings, autoAllowed: await permitted(tab.url) });
  }));
}

async function register(): Promise<void> {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter(o => o.startsWith('https://') || o.startsWith('http://localhost/') || o.startsWith('http://127.0.0.1/'));
  const current = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) {
    if (current.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const registration: chrome.scripting.RegisteredContentScript = {
    id: SCRIPT_ID, matches, js: ['content.js'], runAt: 'document_idle',
    allFrames: false, persistAcrossSessions: true, world: 'ISOLATED',
  };
  if (current.length) await chrome.scripting.updateContentScripts([registration]);
  else await chrome.scripting.registerContentScripts([registration]);
}

async function injectActive(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !await permitted(tab.url)) return;
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch { /* Browser-protected page. */ }
}

async function bootstrap(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await register();
}

chrome.runtime.onInstalled.addListener(() => { void bootstrap().catch(() => undefined); });
chrome.runtime.onStartup.addListener(() => { void bootstrap().catch(() => undefined); });
chrome.permissions.onAdded.addListener(() => {
  void register().then(injectActive).then(async () => notify(await getSettings())).catch(() => undefined);
});
chrome.permissions.onRemoved.addListener(() => {
  void register().then(async () => notify(await getSettings())).catch(() => undefined);
});
chrome.tabs.onActivated.addListener(() => { void injectActive(); });

chrome.runtime.onMessage.addListener((message: Message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
  if (message.type === 'PR_GET_SETTINGS') {
    void getSettings().then(async settings => reply({ settings, autoAllowed: sender.tab ? await permitted(sender.url) : false })).catch(() => reply({ error: 'storage_error' }));
    return true;
  }
  if (message.type === 'PR_UPDATE_SETTINGS' && isUI(sender)) {
    writes = writes.catch(() => undefined).then(async () => {
      const previous = await getSettings();
      const patch = message.patch;
      if (!patch || typeof patch !== 'object' || JSON.stringify(patch).length > 100_000) throw new Error('invalid_settings');
      const next = sanitizeSettings({ ...previous, ...patch, schemaVersion: 1, settingsVersion: previous.settingsVersion + 1 });
      await chrome.storage.local.set({ [KEY]: next });
      await notify(next);
      if (next.autoTranslate) await injectActive();
      reply({ settings: next });
    }).catch(() => reply({ error: 'storage_error' }));
    return true;
  }
  if (message.type === 'PR_CLEAR_CACHE' && isUI(sender)) {
    void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.filter(t => t.id !== undefined).map(tab => chrome.tabs.sendMessage(tab.id!, message)))).then(() => reply({ ok: true }));
    return true;
  }
  if (message.type === 'PR_STATUS' && sender.tab?.id !== undefined && sender.frameId === 0) {
    const status = message.status;
    if (!status || typeof status.state !== 'string') return;
    const text = status.state === 'working' ? '·' : ['needs-download', 'unsupported'].includes(status.state) ? '!' : '';
    void chrome.action.setBadgeText({ tabId: sender.tab.id, text }).catch(() => undefined);
    void chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#254f43' }).catch(() => undefined);
  }
});
