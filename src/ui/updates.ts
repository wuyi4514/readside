import { UPDATE_KEY, type UpdateView } from '../shared/updates';
import type { Message } from '../shared/messages';

/** Shared compact notice; remote release Markdown is never rendered. */
export class UpdateNotice {
  private root = document.getElementById('update-notice')!;
  private heading = document.createElement('strong');
  private download = document.createElement('a');
  private notes = document.createElement('a');
  private later = document.createElement('button');
  private check = document.getElementById('check-update') as HTMLButtonElement | null;
  private status = document.getElementById('update-state');
  private latest?: UpdateView;
  private busy = false;
  constructor() {
    const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
    icon.setAttribute('viewBox','0 0 20 20'); icon.setAttribute('aria-hidden','true'); icon.classList.add('update-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d','M10 3v9m-3-3 3 3 3-3M4 13v3h12v-3'); icon.append(path);
    const body = document.createElement('div'); body.className = 'update-copy';
    const actions = document.createElement('div'); actions.className = 'update-actions';
    this.download.textContent = '下载更新'; this.download.className = 'update-download';
    this.notes.textContent = '更新说明';
    for (const link of [this.download,this.notes]) { link.target = '_blank'; link.rel = 'noreferrer noopener'; }
    this.later.type = 'button'; this.later.textContent = '稍后';
    this.later.addEventListener('click', () => {
      const version = this.latest?.release?.version; if (!version) return;
      void this.send({ type:'PR_UPDATE_DISMISS',version }).then(update => this.render(update)).catch(() => undefined);
    });
    actions.append(this.download,this.notes,this.later); body.append(this.heading,actions); this.root.append(icon,body);
    this.check?.addEventListener('click', () => { void this.run(true); });
    chrome.storage.onChanged.addListener((changes,area) => { if (area === 'local' && changes[UPDATE_KEY]) void this.refresh(); });
    void this.refresh().finally(() => { void this.run(false); });
  }
  private async send(message: Message): Promise<UpdateView> {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.update) throw new Error('update_unavailable');
    return response.update as UpdateView;
  }
  private async refresh(): Promise<void> {
    try { this.render(await this.send({type:'PR_UPDATE_GET'})); }
    catch { if (this.status) this.status.textContent = '暂时无法检查更新，请稍后重试。'; }
  }
  private async run(force: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (force && this.status) this.status.textContent = '正在检查更新…';
    if (this.check) { this.check.disabled = true; this.check.textContent = '正在检查…'; }
    try { this.render(await this.send({type:'PR_UPDATE_CHECK',force})); }
    catch { if (this.latest) this.latest = { ...this.latest, error: 'unavailable' }; else if (this.status) this.status.textContent = '暂时无法检查更新，请稍后重试。'; }
    finally { this.busy = false; if (this.latest) this.render(this.latest); if (this.check) { this.check.disabled = false; this.check.textContent = '检查更新'; } }
  }
  private render(update: UpdateView): void {
    this.latest = update;
    const release = update.release;
    this.root.hidden = !release || update.dismissed;
    if (release) {
      this.heading.textContent = `发现新版本 v${release.version}`;
      this.download.href = release.downloadURL; this.notes.href = release.pageURL;
      this.later.setAttribute('aria-label',`明天再提醒 v${release.version}`);
    }
    const version = document.getElementById('version'); if (version) version.textContent = `v${update.currentVersion}`;
    if (this.status) {
      if (this.busy) { this.status.textContent = '正在检查更新…'; return; }
      this.status.classList.toggle('update-error',!!update.error);
      const checked = update.checkedAt ? ` · ${new Date(update.checkedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 检查` : '';
      this.status.textContent = update.error ? (update.error === 'rate-limit' ? 'GitHub 暂时限制请求，稍后会自动重试。' : '暂时无法检查更新，稍后会自动重试。')
        : release ? `发现 v${release.version}${update.dismissed ? '，明天再提醒' : ''}${checked}`
        : update.checkedAt ? `已是最新版本${checked}` : '每天自动检查一次';
    }
  }
}
