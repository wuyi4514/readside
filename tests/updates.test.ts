import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UPDATE_API, UPDATE_DAY, UPDATE_KEY, newerVersion, publishedRelease, releaseInfo, sanitizeUpdateState, updateView } from '../src/shared/updates';
import { checkUpdate, dismissUpdate, getUpdate, initializeUpdates, restoreUpdateAlarm, UPDATE_ALARM } from '../src/background/updates';

let stored: Record<string, unknown>;
let now: number;
let current: string;
let fetcher: ReturnType<typeof vi.fn>;
const metadata = (tag='v0.4.1') => {
  const release = releaseInfo(tag)!;
  return {tag_name:tag,html_url:release.pageURL,draft:false,prerelease:false,assets:[{name:`readside-${release.version}.zip`,browser_download_url:release.downloadURL,state:'uploaded',size:1234}]};
};
const response = (tag='v0.4.1') => new Response(JSON.stringify(metadata(tag)),{headers:{etag:'"version"'}});
beforeEach(() => {
  now = Date.UTC(2026,9,26); current = '0.4.0'; stored = {};
  vi.spyOn(Date,'now').mockImplementation(()=>now);
  fetcher = vi.fn(async()=>response()); vi.stubGlobal('fetch',fetcher);
  vi.stubGlobal('chrome',{runtime:{getManifest:()=>({version:current})},storage:{local:{
    get:vi.fn(async()=>structuredClone(stored)),set:vi.fn(async(value)=>{stored={...stored,...structuredClone(value)};})
  }},alarms:{create:vi.fn(async()=>undefined),get:vi.fn(async()=>undefined)}});
});

describe('release identity and numeric versions', () => {
  it('compares numeric components, rather than lexicographic strings or tag order', () => {
    expect(newerVersion('0.10.0','0.9.9')).toBe(true);
    expect(newerVersion('0.4.0.1','0.4.0')).toBe(true);
    expect(newerVersion('0.4.0','0.4.0.0')).toBe(false);
    expect(newerVersion('0.4.0-beta','0.3.0')).toBe(false);
    expect(newerVersion('0.3.9','0.4.0')).toBe(false);
  });
  it('accepts only a published stable release with this repository’s finished install ZIP', () => {
    expect(publishedRelease(metadata())).toEqual(releaseInfo('v0.4.1'));
    expect(publishedRelease({...metadata(),draft:true})).toBeUndefined();
    expect(publishedRelease({...metadata(),prerelease:true})).toBeUndefined();
    expect(publishedRelease({...metadata(),tag_name:'v0.5.0-beta.1'})).toBeUndefined();
    expect(publishedRelease({...metadata(),assets:[{name:'Source code.zip'}]})).toBeUndefined();
    const bad=metadata();bad.assets[0]!.browser_download_url='https://example.com/install.zip';
    expect(publishedRelease(bad)).toBeUndefined();
    expect(sanitizeUpdateState({release:{...releaseInfo('v0.4.1'),downloadURL:'javascript:alert(1)'}}).release).toBeUndefined();
  });
});

describe('daily update checks', () => {
  it('checks the real fixed endpoint without credentials and schedules the next daily wake', async () => {
    await initializeUpdates(); const update=await getUpdate();
    expect(update.release?.version).toBe('0.4.1');expect(update.checkedAt).toBe(now);
    expect(fetcher).toHaveBeenCalledWith(UPDATE_API,expect.objectContaining({credentials:'omit',referrerPolicy:'no-referrer',redirect:'error'}));
    expect(chrome.alarms.create).toHaveBeenLastCalledWith(UPDATE_ALARM,{when:now+UPDATE_DAY});
    now+=60_001;await checkUpdate();expect(fetcher).toHaveBeenCalledTimes(1);
    now+=UPDATE_DAY;await checkUpdate();expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('allows manual checking before the daily interval, with a short repeated-click cooldown', async () => {
    await checkUpdate();await checkUpdate(true);expect(fetcher).toHaveBeenCalledTimes(1);
    now+=60_001;await checkUpdate(true);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('coalesces concurrent popup, settings and alarm checks', async () => {
    let finish!: (value:Response)=>void;fetcher.mockImplementation(()=>new Promise<Response>(r=>{finish=r;}));
    const a=checkUpdate(),b=checkUpdate();await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());finish(response());
    const values=await Promise.all([a,b]);expect(values[0]?.release).toEqual(values[1]?.release);
  });
  it('retains a known newer release on network or invalid-response failure', async () => {
    await checkUpdate();const checkedAt=now;now+=60_001;
    fetcher.mockRejectedValueOnce(new Error('offline'));
    const offline=await checkUpdate(true);expect(offline).toMatchObject({error:'unavailable',checkedAt,release:{version:'0.4.1'}});
    expect(chrome.alarms.create).toHaveBeenLastCalledWith(UPDATE_ALARM,{when:now+15*60_000});
    now+=60_001;fetcher.mockResolvedValueOnce(new Response('{}'));
    expect((await checkUpdate(true)).release?.version).toBe('0.4.1');
  });
  it('does not claim current when the first check fails', async () => {
    fetcher.mockRejectedValueOnce(new Error('offline'));expect(await checkUpdate()).toMatchObject({error:'unavailable'});
    expect((await getUpdate()).checkedAt).toBeUndefined();
  });
  it('revalidates a cached release using ETag and handles 304 responses', async () => {
    await checkUpdate();now+=60_001;fetcher.mockResolvedValueOnce(new Response(null,{status:304}));
    const value=await checkUpdate(true);expect(value.error).toBeUndefined();expect(value.release?.version).toBe('0.4.1');
    expect(fetcher.mock.calls[1]?.[1].headers['If-None-Match']).toBe('"version"');
  });
  it('backs off rate limits even when the user requests another check', async () => {
    fetcher.mockResolvedValueOnce(new Response('',{status:429,headers:{'retry-after':'3600'}}));
    expect((await checkUpdate()).error).toBe('rate-limit');now+=60_001;await checkUpdate(true);expect(fetcher).toHaveBeenCalledTimes(1);
    expect(chrome.alarms.create).toHaveBeenLastCalledWith(UPDATE_ALARM,{when:Date.UTC(2026,9,26)+3600_000});
  });
  it('dismisses only the current release for a day and a manual check reveals it again', async () => {
    await checkUpdate();expect((await dismissUpdate('0.4.1')).dismissed).toBe(true);
    expect((await checkUpdate(true)).dismissed).toBe(false);
    await dismissUpdate('0.4.1');now+=60_001;fetcher.mockResolvedValueOnce(response('v0.4.2'));
    const next=await checkUpdate(true);expect(next.release?.version).toBe('0.4.2');expect(next.dismissed).toBe(false);
    await dismissUpdate('0.4.2');now+=UPDATE_DAY;expect((await getUpdate()).dismissed).toBe(false);
  });
  it('automatically clears the alert when the installed version catches up', async () => {
    await checkUpdate();current='0.4.1';expect((await getUpdate()).release).toBeUndefined();
    expect(updateView(sanitizeUpdateState(stored[UPDATE_KEY]),'0.5.0').release).toBeUndefined();
  });
  it('restores a lost worker alarm without issuing an extra network request', async () => {
    await checkUpdate();fetcher.mockClear();await restoreUpdateAlarm();
    expect(fetcher).not.toHaveBeenCalled();expect(chrome.alarms.create).toHaveBeenLastCalledWith(UPDATE_ALARM,{when:now+UPDATE_DAY});
  });

});
