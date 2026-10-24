import { PROVIDERS, PROVIDER_ORIGINS, type Provider, type Settings } from '../shared/settings';
import { ProductSelect } from './select';
import { element, errorText, message } from './common';

export function providerSelect(settings: () => Settings, save: (patch: Partial<Settings>) => Promise<void>, refresh: () => Promise<void>): ProductSelect {
  const select = new ProductSelect(element('provider'), { label: '翻译服务', onChange: async values => {
    const provider = values[0] as Provider;
    // ProductSelect invokes this callback directly from the actual click/key event.
    const origins = PROVIDER_ORIGINS[provider];
    try {
      const granted = !origins.length || await chrome.permissions.request({ origins });
      if (!granted) throw new Error('online_permission');
      await save({ provider }); await refresh(); message('');
    } catch (error) { message(errorText(error), true); throw error; }
  } });
  select.setOptions(PROVIDERS.map(p => ({ value: p.code, label: p.label, detail: p.code === 'chrome-local' ? '离线 · 需准备翻译方向' : '在线 · 文本发送至该服务' })));
  select.setValues([settings().provider]); return select;
}
export async function providerReady(settings: Settings, local: () => Promise<boolean>): Promise<boolean> {
  return settings.provider === 'chrome-local' ? local() : chrome.permissions.contains({ origins: PROVIDER_ORIGINS[settings.provider] });
}
export function providerNote(settings: Settings): void {
  const note = document.getElementById('provider-note');
  if (note) note.textContent = settings.provider === 'chrome-local' ? '在设备上翻译，首次使用需准备翻译方向。' : `使用 ${settings.provider === 'google' ? 'Google' : 'Microsoft'} 在线翻译，无需下载语言包。待翻译文本会发送至该服务。`;
}
