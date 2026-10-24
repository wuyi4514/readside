import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateOnline, onlineMessage } from '../src/background/online';
import { DEFAULT_SETTINGS, sanitizeSettings, settingsChangeRequiresReset } from '../src/shared/settings';

afterEach(() => vi.unstubAllGlobals());
describe('online translation boundaries', () => {
  it('keeps local as default and resets document state when switching services', () => {
    expect(sanitizeSettings({ provider: 'unknown' }).provider).toBe('chrome-local');
    expect(sanitizeSettings({ provider: 'google' }).provider).toBe('google');
    expect(settingsChangeRequiresReset(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, provider: 'google' })).toBe(true);
  });
  it('parses Google segments as plain text, with no cookies or referrer', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([[['阅读。','Read.'],['学习。','Learn.']]])));
    vi.stubGlobal('fetch', fetcher);
    expect(await translateOnline('google','Read. Learn.','en','zh-CN',new AbortController().signal)).toBe('阅读。学习。');
    const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).hostname).toBe('translate.googleapis.com');
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  });
  it('uses the Microsoft public webpage endpoint and maps Chinese correctly', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{translations:[{text:'阅读。'}]}])));
    vi.stubGlobal('fetch', fetcher);
    expect(await translateOnline('microsoft','Read.','en','zh-CN',new AbortController().signal)).toBe('阅读。');
    const [url, init] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get('to')).toBe('zh-Hans'); expect(init.body).toBe('["Read."]');
  });
  it('rejects malformed responses and exposes rate limits without falling back to another service', async () => {
    const fetcher = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', fetcher);
    await expect(translateOnline('google','Read.','en','zh-CN',new AbortController().signal)).rejects.toThrow('online_invalid_response');
    fetcher.mockImplementation(async () => new Response('',{status:429}));
    await expect(translateOnline('microsoft','Read.','en','zh-CN',new AbortController().signal)).rejects.toThrow('online_rate_limit');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not send text if online service was not selected or permission was revoked', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher);
    vi.stubGlobal('chrome',{runtime:{id:'reader'},permissions:{contains:vi.fn(async()=>false)}});
    const sender = {id:'reader',frameId:0,tab:{id:12}} as chrome.runtime.MessageSender;
    const job = {type:'PR_ONLINE',request:'one',op:'translate',provider:'google',source:'en',target:'zh-CN',text:'Read.'};
    let sequence = 0;
    const send = (settings: typeof DEFAULT_SETTINGS) => new Promise(resolve => onlineMessage({...job,request:String(++sequence)},sender,resolve,async()=>({...settings})));
    expect(await send(DEFAULT_SETTINGS)).toMatchObject({ok:false,error:'online_provider_changed'});
    expect(await send({...DEFAULT_SETTINGS,provider:'google'})).toMatchObject({ok:false,error:'online_permission'});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
