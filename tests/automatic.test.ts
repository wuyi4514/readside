import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomaticControls } from '../src/ui/automatic';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../src/shared/settings';

let settings: Settings;
let controls: AutomaticControls;
const grant = vi.fn(async () => true);
const remove = vi.fn(async () => true);
const save = vi.fn(async (patch: Partial<Settings>) => { settings = sanitizeSettings({ ...settings, ...patch }); });
function choose(id: string): void { document.querySelector<HTMLInputElement>(`#${id}`)!.click(); }

beforeEach(() => {
  grant.mockReset().mockResolvedValue(true); remove.mockReset().mockResolvedValue(true); save.mockClear();
  settings = sanitizeSettings(DEFAULT_SETTINGS);
  vi.stubGlobal('chrome', { permissions: { request: grant, remove } });
  document.body.innerHTML = '<fieldset id="auto-controls"><input id="auto-on" name="auto" type="radio" value="on"><input id="auto-off" name="auto" type="radio" value="off"></fieldset><fieldset id="all-sites-controls"><input id="all-sites-yes" name="all-sites" type="radio" value="on"><input id="all-sites-no" name="all-sites" type="radio" value="off"></fieldset><p id="message" hidden></p>';
  controls = new AutomaticControls(() => settings, () => true, save); controls.render();
});

describe('explicit automatic scope and authorization', () => {
  it('requests access within the input event and commits the scope exactly once', async () => {
    let inEvent = true;
    grant.mockImplementation(async () => { expect(inEvent).toBe(true); return true; });
    choose('all-sites-yes'); inEvent = false;
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(grant).toHaveBeenCalledTimes(1); expect(settings.autoTranslateAllPages).toBe(true);
    expect(settings.autoTranslate).toBe(false);
  });
  it('restores the selected option without saving when access is denied', async () => {
    grant.mockResolvedValue(false); choose('all-sites-yes');
    await vi.waitFor(() => expect(document.querySelector<HTMLFieldSetElement>('#all-sites-controls')!.disabled).toBe(false));
    expect(save).not.toHaveBeenCalled(); expect(settings.autoTranslateAllPages).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#all-sites-no')!.checked).toBe(true);
  });
  it('narrows automatic scope before revoking broad access and retains the master preference', async () => {
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, autoTranslate: true, autoTranslateAllPages: true }); controls.render();
    const order: string[] = [];
    save.mockImplementationOnce(async patch => { order.push('save'); settings = sanitizeSettings({ ...settings, ...patch }); });
    remove.mockImplementationOnce(async () => { order.push('remove'); expect(settings.autoTranslateAllPages).toBe(false); return true; });
    choose('all-sites-no'); await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(order).toEqual(['save', 'remove']); expect(settings.autoTranslate).toBe(true);
  });
  it('can request revoked access again by clicking the already selected yes option', async () => {
    settings = sanitizeSettings({ ...DEFAULT_SETTINGS, autoTranslateAllPages: true }); controls.render();
    choose('all-sites-yes'); await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(grant).toHaveBeenCalledOnce();
  });
});
