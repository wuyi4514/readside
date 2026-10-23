import type { Settings } from '../shared/settings';
import { errorText, message } from './common';

export function setChoice(name: string, enabled: boolean): void {
  for (const radio of document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) radio.checked = radio.value === (enabled ? 'on' : 'off');
}

export function onChoice(name: string, handle: (enabled: boolean) => void): void {
  for (const radio of document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
    radio.addEventListener('change', () => { if (radio.checked) handle(radio.value === 'on'); });
  }
}

export class AutomaticControls {
  private pending = false;
  constructor(private settings: () => Settings, private ready: () => boolean, private save: (patch: Partial<Settings>) => Promise<void>) {
    onChoice('auto', enabled => {
      if (this.pending) return;
      if (enabled && !this.ready()) { message('请先在设置中下载语言包。', true); this.render(); return; }
      // Start the optional permission request directly in the actual input event.
      const request = enabled && this.settings().autoTranslateAllPages
        ? chrome.permissions.request({ origins: ['https://*/*'] }) : Promise.resolve(true);
      this.commit(request, { autoTranslate: enabled });
    });
    const setAllSites = (enabled: boolean): void => {
      if (this.pending) return;
      const request = enabled ? chrome.permissions.request({ origins: ['https://*/*'] }) : Promise.resolve(true);
      this.commit(request, { autoTranslateAllPages: enabled }, !enabled);
    };
    onChoice('all-sites', setAllSites);
    // A revoked permission can leave the persisted preference selected. Clicking
    // that same radio must still let the user grant access again.
    document.getElementById('all-sites-yes')?.addEventListener('click', () => {
      if (this.settings().autoTranslateAllPages) setAllSites(true);
    });
  }

  private commit(request: Promise<boolean>, patch: Partial<Settings>, revokeAll = false): void {
    this.pending = true; this.disable();
    void request.then(async granted => {
      if (!granted) { message('未获得网站访问权限，设置未更改。'); return; }
      await this.save(patch);
      // Scope is persisted first, so narrowing it stops broad automatic work even
      // if the browser cannot remove a permission (e.g. a managed installation).
      if (revokeAll) await chrome.permissions.remove({ origins: ['https://*/*'] });
    }).catch(error => message(errorText(error), true)).finally(() => { this.pending = false; this.render(); });
  }

  private disable(): void {
    for (const id of ['auto-controls', 'all-sites-controls']) {
      const fieldset = document.getElementById(id) as HTMLFieldSetElement | null;
      if (fieldset) fieldset.disabled = this.pending;
    }
  }

  render(): void {
    setChoice('auto', this.settings().autoTranslate);
    setChoice('all-sites', this.settings().autoTranslateAllPages);
    this.disable();
  }
}
