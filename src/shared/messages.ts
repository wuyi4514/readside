import type { Settings } from './settings';

export type PageState = 'off' | 'paused' | 'working' | 'ready' | 'partial' | 'needs-download' | 'unsupported';
export interface PageStatus {
  state: PageState;
  translated: number;
  skipped: number;
  failed: number;
  pending: number;
  error?: string;
  missingLanguages?: string[];
}
export const EMPTY_STATUS: PageStatus = { state: 'off', translated: 0, skipped: 0, failed: 0, pending: 0 };
export type Message =
  | { type: 'PR_GET_SETTINGS' }
  | { type: 'PR_UPDATE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'PR_STATUS'; status: PageStatus }
  | { type: 'PR_GET_STATUS' }
  | { type: 'PR_SETTINGS'; settings: Settings; autoAllowed: boolean }
  | { type: 'PR_TRANSLATE' }
  | { type: 'PR_RESTORE' }
  | { type: 'PR_RETRY' }
  | { type: 'PR_CLEAR_CACHE' }
  | { type: 'PR_MODELS_READY' }
  | { type: 'PR_NATIVE' | 'PR_NATIVE_CANCEL'; request: string; client: string; op?: string; source?: string; target?: string; text?: string };

export async function loadSettings(): Promise<Settings> {
  const response = await chrome.runtime.sendMessage({ type: 'PR_GET_SETTINGS' } satisfies Message);
  if (!response?.settings) throw new Error('扩展连接已失效，请刷新网页。');
  return response.settings as Settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const response = await chrome.runtime.sendMessage({ type: 'PR_UPDATE_SETTINGS', patch } satisfies Message);
  if (!response?.settings) throw new Error('设置未保存，请重试。');
  return response.settings as Settings;
}
