import { UPDATE_API, UPDATE_DAY, UPDATE_KEY, publishedRelease, sanitizeUpdateState, updateView, type UpdateState, type UpdateView } from '../shared/updates';

export const UPDATE_ALARM = 'readside-update-check';
let active: Promise<UpdateView> | undefined;
let writes: Promise<unknown> = Promise.resolve();
async function read(): Promise<UpdateState> { return sanitizeUpdateState((await chrome.storage.local.get(UPDATE_KEY))[UPDATE_KEY]); }
function write(change: (state: UpdateState) => UpdateState): Promise<UpdateState> {
  const pending = writes.catch(() => undefined).then(async () => {
    const state = sanitizeUpdateState(change(await read())); await chrome.storage.local.set({ [UPDATE_KEY]: state }); return state;
  });
  writes = pending; return pending;
}
const view = (state: UpdateState): UpdateView => updateView(state, chrome.runtime.getManifest().version);
async function schedule(state: UpdateState): Promise<void> {
  await chrome.alarms.create(UPDATE_ALARM, { when: Math.max(Date.now() + 60_000, state.nextCheckAt ?? Date.now() + UPDATE_DAY) });
}
export async function getUpdate(): Promise<UpdateView> { return view(await read()); }
export async function dismissUpdate(version: string): Promise<UpdateView> {
  return view(await write(state => state.release?.version === version ? { ...state, dismissedVersion: version, dismissedUntil: Date.now() + UPDATE_DAY } : state));
}
export async function checkUpdate(force = false): Promise<UpdateView> {
  if (force) await write(state => ({ ...state, dismissedUntil: 0 }));
  if (active) return active;
  active = runCheck(force).finally(() => { active = undefined; });
  return active;
}
async function runCheck(force: boolean): Promise<UpdateView> {
  const previous = await read(), now = Date.now();
  if ((previous.limitedUntil ?? 0) > now || (previous.attemptedAt !== undefined && now - previous.attemptedAt < 60_000)
    || (!force && (previous.nextCheckAt ?? 0) > now)) { await schedule(previous); return view(previous); }
  await write(state => ({ ...state, attemptedAt: now, nextCheckAt: now + 15 * 60_000 }));
  let limitedUntil: number | undefined;
  let result: UpdateState;
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (previous.etag && previous.release) headers['If-None-Match'] = previous.etag;
    const response = await fetch(UPDATE_API, { headers, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(12_000) });
    if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      const retry = Number(response.headers.get('retry-after')), reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      limitedUntil = Math.min(now + UPDATE_DAY, Math.max(now + 15 * 60_000, now + (Number.isFinite(retry) ? retry * 1000 : 0), Number.isFinite(reset) ? reset : 0));
      throw new Error('rate-limit');
    }
    let release = previous.release;
    if (response.status !== 304 || !release) {
      if (!response.ok || Number(response.headers.get('content-length')) > 256 * 1024) throw new Error('unavailable');
      const text = await response.text(); if (text.length > 256 * 1024) throw new Error('unavailable');
      release = publishedRelease(JSON.parse(text)); if (!release) throw new Error('unavailable');
    }
    const etag = response.headers.get('etag') ?? previous.etag;
    result = await write(state => ({ ...state, release, checkedAt: now, nextCheckAt: now + UPDATE_DAY, error: undefined, limitedUntil: undefined,
      etag: etag && etag.length < 200 && !/[\r\n]/.test(etag) ? etag : undefined }));
  } catch {
    result = await write(state => ({ ...state, error: limitedUntil ? 'rate-limit' : 'unavailable', limitedUntil, nextCheckAt: limitedUntil ?? now + 15 * 60_000 }));
  }
  await schedule(result); return view(result);
}
export async function initializeUpdates(): Promise<void> { await checkUpdate(); }
export async function restoreUpdateAlarm(): Promise<void> {
  if (!await chrome.alarms.get(UPDATE_ALARM)) await schedule(await read());
}
