import { EMPTY_STATUS, loadSettings, saveSettings, type Message, type PageStatus } from '../shared/messages';
import { DEFAULT_SETTINGS, LANGUAGES, sanitizeSettings, validOrigin, type Settings, type TargetLanguage, type SourceLanguage } from '../shared/settings';
import { element, errorText, message, optionsPage, anyLanguageReady } from './common';
import { ProductSelect } from './select';
import { populateLanguages } from './languages';
import { AutomaticControls, onChoice, setChoice } from './automatic';

let settings: Settings = { ...DEFAULT_SETTINGS, siteRules: {} };
let tab: chrome.tabs.Tab | undefined;
let origin: string | null = null;
let engineReady = false;
const source = new ProductSelect(element('source'), { label: '源语言', multiple: true, onChange: async values => {
  try {
    await update({ sourceLanguages: values as SourceLanguage[] }); engineReady = await anyLanguageReady(settings.sourceLanguages, settings.targetLanguage);
    if (!engineReady) message('所选翻译方向尚未就绪，请在设置中准备。'); await refresh();
  } catch (error) { message(errorText(error), true); throw error; }
} });
const target = new ProductSelect(element('target'), { label: '目标语言', onChange: async values => {
  try { await update({ targetLanguage: values[0] as TargetLanguage }); await refreshLanguages(); }
  catch (error) { message(errorText(error), true); throw error; }
} });
target.setOptions([{ value: 'zh-CN', label: '简体中文' }, ...LANGUAGES.filter(l => l.code !== 'zh-CN').map(l => ({ value: l.code, label: l.label }))]);
const automatic = new AutomaticControls(() => settings, () => engineReady, update);

function permissionPattern(): string | null {
  if (!origin) return null;
  const url = new URL(origin); return `${url.protocol}//${url.hostname}/*`;
}
function supported(): boolean {
  if (!origin) return false;
  const url = new URL(origin); return url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname);
}
function renderStatus(status: PageStatus, fallback?: string): void {
  element('status').dataset.state = status.state;
  const label: Record<PageStatus['state'], string> = {
    off: '自动翻译已关闭', paused: '此页已恢复原文', working: '正在翻译…',
    ready: status.translated ? `已对照 ${status.translated} 块内容` : '未发现可翻译的内容',
    partial: `已对照 ${status.translated} 块，部分内容未完成`,
    'needs-download': '请先准备翻译方向', unsupported: '此页面或语言暂不支持',
  };
  const missing = status.missingLanguages?.map(code => LANGUAGES.find(l => l.code === code)?.label ?? code).join('、');
  element('status-text').textContent = fallback ?? (missing ? `${missing}翻译方向未就绪，请在设置中准备` : label[status.state]);
  element('retry').hidden = status.state !== 'partial';
}
async function pageMessage(command: Message, inject = false): Promise<PageStatus> {
  if (tab?.id === undefined || !supported()) throw new Error('unsupported_page');
  if (inject) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  const response = await chrome.tabs.sendMessage(tab.id, command); return response?.status ?? EMPTY_STATUS;
}
async function refresh(): Promise<void> {
  const pattern = permissionPattern();
  const granted = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
  const selected = !!origin && settings.siteRules[origin] === 'always';
  element('allow-site').hidden = !supported() || settings.autoTranslateAllPages || (selected && granted);
  try {
    const status = await pageMessage({ type: 'PR_GET_STATUS' });
    renderStatus(status, status.state === 'off' && settings.autoTranslate && !settings.autoTranslateAllPages && !selected ? '此网站尚未开启自动翻译' : undefined);
  } catch {
    renderStatus(EMPTY_STATUS, !supported() ? '此页面不支持翻译' : !engineReady ? '请先在设置中准备翻译方向' : settings.autoTranslate ? '此网站尚未开启自动翻译' : '自动翻译已关闭');
  }
}
async function update(patch: Partial<Settings>): Promise<void> {
  settings = await saveSettings(patch); automatic.render(); await refresh();
}
element('translate').addEventListener('click', () => {
  if (!engineReady) { optionsPage(); return; }
  void pageMessage({ type: 'PR_TRANSLATE' }, true).then(renderStatus).catch(() => message('请在普通网页上使用；更新插件后请刷新页面。', true));
});
element('restore').addEventListener('click', () => {
  void pageMessage({ type: 'PR_RESTORE' }).then(renderStatus).catch(() => renderStatus({ ...EMPTY_STATUS, state: 'paused' }));
});
element('retry').addEventListener('click', () => { void pageMessage({ type: 'PR_RETRY' }).then(renderStatus).catch(error => message(errorText(error), true)); });
element('allow-site').addEventListener('click', () => {
  const pattern = permissionPattern(); if (!pattern || !origin) return;
  const site = origin;
  void chrome.permissions.request({ origins: [pattern] }).then(async granted => {
    if (!granted) { message('未获得此网站的访问权限。'); return; }
    await update({ siteRules: { ...settings.siteRules, [site]: 'always' } });
    if (!settings.autoTranslate) message('已允许此网站。开启自动翻译后生效。');
  }).catch(error => message(errorText(error), true));
});
onChoice('selection', enabled => { void update({ selectionLookup: enabled }).catch(error => message(errorText(error), true)); });
element('settings').addEventListener('click', optionsPage);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue) return;
  const previousSource = settings.sourceLanguages.join(',') + '>' + settings.targetLanguage;
  settings = sanitizeSettings(changes.settings.newValue); automatic.render(); setChoice('selection', settings.selectionLookup); source.setValues(settings.sourceLanguages); target.setValues([settings.targetLanguage]);
  if (previousSource !== settings.sourceLanguages.join(',') + '>' + settings.targetLanguage) void refreshLanguages();
});
let languageEpoch = 0;
async function refreshLanguages(): Promise<void> {
  const epoch = ++languageEpoch; const snapshot = settings;
  target.setValues([snapshot.targetLanguage]); await populateLanguages(source, snapshot.sourceLanguages, snapshot.targetLanguage);
  if (epoch !== languageEpoch) return; const ready = await anyLanguageReady(snapshot.sourceLanguages, snapshot.targetLanguage); if (epoch === languageEpoch) engineReady = ready;
}
void (async () => {
  settings = await loadSettings(); [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); origin = validOrigin(tab?.url);
  automatic.render(); setChoice('selection', settings.selectionLookup); await refreshLanguages(); await refresh();
})().catch(error => message(errorText(error), true));
const poll = window.setInterval(() => { void refresh(); }, 1200);
window.addEventListener('pagehide', () => clearInterval(poll));
