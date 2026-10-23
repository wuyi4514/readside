import { apiLanguage } from '../shared/settings';
import { nativeAPIs, type Availability } from '../providers/native-types';

export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
}

export function message(text: string, error = false): void {
  const target = element('message');
  target.textContent = text; target.hidden = !text; target.classList.toggle('error', error);
}

export async function readiness(source: string, target = 'zh-CN'): Promise<Availability> {
  const api = nativeAPIs();
  if (!api.translator || !api.detector) return 'unavailable';
  const states = await Promise.all([api.translator.availability({ sourceLanguage: apiLanguage(source), targetLanguage: apiLanguage(target) }), api.detector.availability()]);
  if (states.includes('unavailable')) return 'unavailable';
  if (states.every(s => s === 'available')) return 'available';
  return states.includes('downloading') ? 'downloading' : 'downloadable';
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return '已取消。可以稍后继续准备。';
  return '操作未完成。请检查网络和 Chrome 的本地翻译可用状态后重试。';
}

export function optionsPage(): void { void chrome.runtime.openOptionsPage(); }

export async function anyLanguageReady(sources: readonly string[], target = 'zh-CN'): Promise<boolean> {
  return (await Promise.all(sources.filter(source => source !== target).map(source => readiness(source, target).catch(() => 'unavailable')))).some(state => state === 'available');
}
