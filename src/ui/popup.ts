import { EMPTY_STATUS, loadSettings, saveSettings, type Message, type PageStatus } from '../shared/messages';
import { validOrigin, type Settings, type SiteRule, type SourceLanguage } from '../shared/settings';
import { element, errorText, message, optionsPage, populateLanguages, readiness } from './common';

let settings: Settings;
let tab: chrome.tabs.Tab | undefined;
let origin: string | null = null;
let engineReady = false;
let grantedCurrent = false;
const source = element<HTMLSelectElement>('source');
const toggle = element<HTMLButtonElement>('auto');
const rule = element<HTMLSelectElement>('site-rule');
const selection = element<HTMLInputElement>('selection');
toggle.disabled = true;

function permissionPattern(): string | null {
  if (!origin) return null;
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

function supported(): boolean {
  if (!origin) return false;
  const url = new URL(origin);
  return url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname);
}

function renderStatus(status: PageStatus, fallback?: string): void {
  element('status').dataset.state = status.state;
  const label: Record<PageStatus['state'], string> = {
    off: '自动对照已关闭', paused: '此页已恢复原文', working: '正在翻译可见内容…',
    ready: status.translated ? `已对照 ${status.translated} 块内容` : '当前未发现可安全翻译的内容',
    partial: `已对照 ${status.translated} 块，部分内容可重试`,
    'needs-download': '需要准备本地语言包', unsupported: '此页面或语言方向暂不支持',
  };
  element('status-text').textContent = fallback ?? label[status.state];
  element('retry').hidden = status.state !== 'partial';
}

async function pageMessage(command: Message, inject = false): Promise<PageStatus> {
  if (tab?.id === undefined || !supported()) throw new Error('unsupported_page');
  if (inject) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  const response = await chrome.tabs.sendMessage(tab.id, command);
  return response?.status ?? EMPTY_STATUS;
}

async function refresh(): Promise<void> {
  try { renderStatus(await pageMessage({ type: 'PR_GET_STATUS' })); }
  catch {
    const pattern = permissionPattern();
    const granted = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
    renderStatus(EMPTY_STATUS, !supported() ? '浏览器保护的页面无法翻译' : !engineReady ? '先准备本地翻译，再开始阅读' : settings.autoTranslate && !granted ? '此网站尚未获得自动翻译权限' : settings.autoTranslate ? '自动对照已开启，激活网页后生效' : '自动对照已关闭');
  }
}

async function update(patch: Partial<Settings>): Promise<void> {
  settings = await saveSettings(patch); toggle.setAttribute('aria-checked', String(settings.autoTranslate));
}

toggle.addEventListener('click', () => {
  if (!settings.autoTranslate && !engineReady) { optionsPage(); return; }
  toggle.disabled = true;
  const request = !settings.autoTranslate && !grantedCurrent ? chrome.permissions.request({ origins: ['https://*/*'] }) : Promise.resolve(true);
  void request.then(async granted => {
    if (!granted) { message('未开启全部网站。可使用“翻译当前页”，或只授权此网站。'); return; }
    await update({ autoTranslate: !settings.autoTranslate });
    if (settings.autoTranslate && supported()) await pageMessage({ type: 'PR_SETTINGS', settings, autoAllowed: true }, true);
    await refresh();
  }).catch(error => message(errorText(error), true)).finally(() => { toggle.disabled = false; });
});

element('translate').addEventListener('click', () => {
  if (!engineReady) { optionsPage(); return; }
  void pageMessage({ type: 'PR_TRANSLATE' }, true).then(renderStatus).catch(() => message('此页面无法翻译。请在普通 HTTPS 网页上使用；更新插件后请刷新页面。', true));
});
element('restore').addEventListener('click', () => {
  void pageMessage({ type: 'PR_RESTORE' }).then(renderStatus).catch(() => renderStatus({ ...EMPTY_STATUS, state: 'paused' }));
});
element('retry').addEventListener('click', () => { void pageMessage({ type: 'PR_RETRY' }).then(renderStatus).catch(error => message(errorText(error), true)); });
source.addEventListener('change', () => {
  void update({ sourceLanguage: source.value as SourceLanguage }).then(async () => {
    engineReady = await readiness(settings.sourceLanguage) === 'available';
    if (!engineReady) message('该语言需要先准备语言包。点击“翻译当前页”进入准备。');
    await refresh();
  }).catch(error => message(errorText(error), true));
});
rule.addEventListener('change', () => {
  if (!origin) return;
  const next = rule.value as SiteRule;
  const pattern = permissionPattern();
  const request = next === 'always' && pattern ? chrome.permissions.request({ origins: [pattern] }) : Promise.resolve(true);
  void request.then(async granted => {
    if (!granted) { rule.value = settings.siteRules[origin!] ?? 'follow-global'; message('未获得此网站的自动翻译权限。'); return; }
    if (next === 'always') grantedCurrent = true;
    const siteRules = { ...settings.siteRules };
    if (next === 'follow-global') delete siteRules[origin!]; else siteRules[origin!] = next;
    await update({ siteRules });
    if (next === 'always' && !settings.autoTranslate) message('已记住此网站。开启全局自动翻译后生效。');
    await refresh();
  }).catch(error => message(errorText(error), true));
});
selection.addEventListener('change', () => { void update({ selectionLookup: selection.checked }).catch(error => message(errorText(error), true)); });
element('settings').addEventListener('click', optionsPage);
element('options').addEventListener('click', optionsPage);

void (async () => {
  settings = await loadSettings();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  origin = validOrigin(tab?.url);
  const pattern = permissionPattern();
  grantedCurrent = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
  element('site').textContent = origin ? new URL(origin).hostname : '浏览器页面';
  rule.disabled = !supported(); rule.value = origin ? settings.siteRules[origin] ?? 'follow-global' : 'follow-global';
  toggle.setAttribute('aria-checked', String(settings.autoTranslate)); selection.checked = settings.selectionLookup;
  await populateLanguages(source, settings.sourceLanguage);
  engineReady = await readiness(settings.sourceLanguage).catch(() => 'unavailable') === 'available';
  toggle.disabled = false; await refresh();
})().catch(error => message(errorText(error), true));

const poll = window.setInterval(() => { if (settings) void refresh(); }, 1200);
window.addEventListener('pagehide', () => clearInterval(poll));
