import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateNotice } from '../src/ui/updates';
import { releaseInfo, type UpdateView } from '../src/shared/updates';

let latest: UpdateView;
let send: ReturnType<typeof vi.fn>;
let changed: (changes: Record<string,unknown>, area: string) => void;
beforeEach(() => {
  document.body.innerHTML='<section id="update-notice" role="alert" hidden></section><span id="version"></span><button id="check-update">检查更新</button><p id="update-state"></p>';
  latest={currentVersion:'0.4.0',checkedAt:Date.now(),release:releaseInfo('v0.4.1'),dismissed:false};
  send=vi.fn(async(message)=>{
    if(message.type==='PR_UPDATE_DISMISS')latest={...latest,dismissed:true};
    if(message.type==='PR_UPDATE_CHECK'&&message.force)latest={...latest,dismissed:false};
    return{update:latest};
  });
  vi.stubGlobal('chrome',{runtime:{sendMessage:send},storage:{onChanged:{addListener:(fn:typeof changed)=>{changed=fn;}}}});
  new UpdateNotice();
});
afterEach(()=>{document.body.replaceChildren();vi.unstubAllGlobals();});
const notice=()=>document.querySelector<HTMLElement>('#update-notice')!;
const settle=()=>vi.waitFor(()=>expect(document.querySelector<HTMLButtonElement>('#check-update')!.disabled).toBe(false));
describe('update notice controls',()=>{
  it('shows the exact packaged download and release notes without remote HTML',async()=>{
    await vi.waitFor(()=>expect(notice().hidden).toBe(false));
    expect(notice().textContent).toContain('发现新版本 v0.4.1');
    expect(notice().querySelector('a')?.href).toBe('https://github.com/wuyi4514/readside/releases/download/v0.4.1/readside-0.4.1.zip');
    expect(notice().querySelectorAll('a')[1]?.href).toBe('https://github.com/wuyi4514/readside/releases/tag/v0.4.1');
    expect(document.querySelector('#version')?.textContent).toBe('v0.4.0');
  });
  it('hides the same version for later and an explicit manual check restores the notice',async()=>{
    await settle();notice().querySelector('button')!.click();await vi.waitFor(()=>expect(notice().hidden).toBe(true));
    document.querySelector<HTMLButtonElement>('#check-update')!.click();await vi.waitFor(()=>expect(notice().hidden).toBe(false));
    expect(send).toHaveBeenCalledWith({type:'PR_UPDATE_CHECK',force:true});
  });
  it('keeps an existing download available when a check fails',async()=>{
    await settle();latest={...latest,error:'unavailable'};changed({updateCheck:{}},'local');
    await vi.waitFor(()=>expect(document.querySelector('#update-state')?.textContent).toContain('暂时无法检查'));
    expect(notice().hidden).toBe(false);expect(notice().querySelector('a')?.href).toContain('readside-0.4.1.zip');
  });
  it('hides the alert once there is no newer version and states the last successful check',async()=>{
    await settle();latest={currentVersion:'0.4.1',checkedAt:Date.now(),dismissed:false};changed({updateCheck:{}},'local');
    await vi.waitFor(()=>expect(notice().hidden).toBe(true));
    expect(document.querySelector('#update-state')?.textContent).toContain('已是最新版本');
  });
});
