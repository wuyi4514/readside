export const UPDATE_KEY = 'updateCheck';
export const UPDATE_API = 'https://api.github.com/repos/wuyi4514/readside/releases/latest';
const REPOSITORY = 'https://github.com/wuyi4514/readside';
export const UPDATE_DAY = 24 * 60 * 60 * 1000;
export interface ReleaseInfo { version: string; tag: string; pageURL: string; downloadURL: string }
export interface UpdateState {
  checkedAt?: number;
  attemptedAt?: number;
  nextCheckAt?: number;
  limitedUntil?: number;
  release?: ReleaseInfo;
  etag?: string;
  error?: 'unavailable' | 'rate-limit';
  dismissedVersion?: string;
  dismissedUntil?: number;
}
export interface UpdateView {
  currentVersion: string;
  checkedAt?: number;
  release?: ReleaseInfo;
  error?: UpdateState['error'];
  dismissed: boolean;
}
export function versionParts(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value) || value.length > 24) return;
  const parts = value.split('.').map(Number);
  if (parts.some(part => part > 65535)) return;
  return parts;
}
export function newerVersion(next: string, current: string): boolean {
  const a = versionParts(next), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 4; i++) { const diff = (a[i] ?? 0) - (b[i] ?? 0); if (diff) return diff > 0; }
  return false;
}
export function releaseInfo(tag: unknown): ReleaseInfo | undefined {
  if (typeof tag !== 'string') return;
  const version = tag.replace(/^v/, '');
  if (!versionParts(version)) return;
  return { version, tag, pageURL: `${REPOSITORY}/releases/tag/${tag}`, downloadURL: `${REPOSITORY}/releases/download/${tag}/readside-${version}.zip` };
}
export function publishedRelease(value: unknown): ReleaseInfo | undefined {
  if (!value || typeof value !== 'object') return;
  const data = value as Record<string, unknown>, release = releaseInfo(data.tag_name);
  if (!release || data.draft !== false || data.prerelease !== false || data.html_url !== release.pageURL || !Array.isArray(data.assets)) return;
  const asset = data.assets.find((item: Record<string, unknown> | null) => item && item.name === `readside-${release.version}.zip`
    && item.browser_download_url === release.downloadURL && item.state === 'uploaded' && typeof item.size === 'number' && item.size > 0);
  return asset ? release : undefined;
}
export function sanitizeUpdateState(value: unknown): UpdateState {
  if (!value || typeof value !== 'object') return {};
  const data = value as Record<string, unknown>, state: UpdateState = {};
  for (const key of ['checkedAt','attemptedAt','nextCheckAt','limitedUntil','dismissedUntil'] as const) {
    const time = data[key]; if (typeof time === 'number' && Number.isFinite(time) && time >= 0) state[key] = time;
  }
  const cached = data.release as Partial<ReleaseInfo> | undefined;
  const release = cached && releaseInfo(cached.tag);
  if (release && cached?.version === release.version && cached.pageURL === release.pageURL && cached.downloadURL === release.downloadURL) state.release = release;
  if (typeof data.etag === 'string' && data.etag.length < 200 && !/[\r\n]/.test(data.etag)) state.etag = data.etag;
  if (data.error === 'unavailable' || data.error === 'rate-limit') state.error = data.error;
  if (typeof data.dismissedVersion === 'string' && versionParts(data.dismissedVersion)) state.dismissedVersion = data.dismissedVersion;
  return state;
}
export function updateView(state: UpdateState, currentVersion: string, now = Date.now()): UpdateView {
  const release = state.release && newerVersion(state.release.version, currentVersion) ? state.release : undefined;
  return { currentVersion, checkedAt: state.checkedAt, release, error: state.error,
    dismissed: !!release && state.dismissedVersion === release.version && (state.dismissedUntil ?? 0) > now };
}
