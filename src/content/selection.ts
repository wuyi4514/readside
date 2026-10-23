import type { LocalEngine } from '../providers/local';
import { LANGUAGES, type Settings } from '../shared/settings';
import { classify } from './language';
import { SENSITIVE, sourceText } from './extractor';

const CSS = `:host{all:initial;position:fixed;z-index:2147483647;display:block;color-scheme:light dark;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;color:#202124;line-height:1.65}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0;border-radius:6px;padding:6px 10px;background:#25272c;color:#ffffff}button:focus-visible{outline:2px solid #3266e8;outline-offset:3px}.panel{width:min(320px,calc(100vw - 24px));padding:17px;background:#ffffff;box-shadow:0 4px 25px #10182826;border:1px solid #e6e8ec;border-radius:11px}.top{display:flex;justify-content:space-between;align-items:center;color:#666b74;font-size:10px;letter-spacing:.3px}.close{color:inherit;background:none;font-size:19px;padding:0 4px}.source{font-family:inherit;font-size:16px;margin:13px 0 8px;white-space:pre-wrap;max-height:150px;overflow:auto;overflow-wrap:anywhere}.result{font-size:13px;white-space:pre-wrap;max-height:210px;overflow:auto;margin-top:5px}.label{font-size:10px;color:#666b74;margin-top:12px}.actions{display:flex;gap:13px;align-items:center;margin-top:13px}.copy{padding:0;background:none;color:#25272c;font-size:11px}.note{font-size:10px;color:#666b74;margin-top:13px;border-top:1px solid #e6e8ec;padding-top:9px}.context{font-size:11px;color:#666b74;white-space:pre-wrap;margin-top:7px} @media(prefers-color-scheme:dark){:host{color:#eeeef0}.panel{background:#222428;border-color:#4b505b}.top,.label,.context,.note{color:#a4a9b3}.copy{color:#c5d5ff}.note{border-color:#363941}button{background:#ebedf2;color:#202228}.close{background:none;color:#a4a9b3}}`;

export class SelectionLookup {
  private host?: HTMLElement;
  private abort?: AbortController;
  private range?: Range;
  private text = '';
  private context = '';
  private previousFocus?: Element | null;
  private translated = '';
  private timer = 0;
  private root?: ShadowRoot;
  private sourceURL = '';
  constructor(private engine: () => LocalEngine, private settings: () => Settings) {
    document.addEventListener('pointerup', event => {
      if (this.host && event.composedPath().includes(this.host)) return;
      clearTimeout(this.timer); this.timer = window.setTimeout(() => this.capture(), 80);
    });
    document.addEventListener('keyup', event => {
      if (event.key === 'Escape') this.close(true);
      else if (event.shiftKey) { clearTimeout(this.timer); this.timer = window.setTimeout(() => this.capture(), 120); }
    });
    document.addEventListener('pointerdown', event => {
      if (this.host && !event.composedPath().includes(this.host)) this.close();
    }, true);
    window.addEventListener('scroll', () => { if (this.host) this.close(); }, { passive: true });
    window.addEventListener('blur', () => this.close());
  }
  update(): void { if (!this.settings().selectionLookup) this.close(); }

  private capture(): void {
    if (!this.settings().selectionLookup || !isSecureContext) return;
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const start = range.startContainer.parentElement, end = range.endContainer.parentElement;
    if (!start || !end || start.closest(SENSITIVE) || end.closest(SENSITIVE)) return;
    const common = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!common || [...common.querySelectorAll(SENSITIVE)].some(node => range.intersectsNode(node))) return;
    const text = selection.toString().trim();
    if (!text || text.length > 1000) { this.close(); return; }
    this.close(); this.range = range.cloneRange(); this.text = text; this.sourceURL = location.href;
    const paragraph = start.closest('p,li,blockquote,div');
    const context = paragraph ? sourceText(paragraph) : '';
    this.context = context.length <= 500 && context !== text ? context : '';
    this.previousFocus = document.activeElement;
    this.host = document.createElement('span'); this.host.dataset.prOwned = 'lookup';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = CSS; this.root.append(style);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '查译'; button.setAttribute('aria-label', '翻译选中的词句');
    button.addEventListener('click', event => { event.stopPropagation(); void this.lookup(); });
    this.root.append(button); document.documentElement.append(this.host); this.position();
  }

  private position(): void {
    if (!this.host || !this.range) return;
    const rect = this.range.getBoundingClientRect();
    const width = this.host.offsetWidth, height = this.host.offsetHeight;
    this.host.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    this.host.style.top = `${Math.max(12, rect.bottom + height + 12 <= innerHeight ? rect.bottom + 8 : rect.top - height - 8)}px`;
  }

  private panel(): HTMLElement {
    const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '词句查译'); panel.lang = 'zh-CN';
    const top = document.createElement('div'); top.className = 'top';
    const title = document.createElement('span'); title.textContent = `${LANGUAGES.find(l => l.code === this.settings().sourceLanguage)?.label ?? ''} → 简体中文`;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭查译'); close.addEventListener('click', () => this.close(true));
    top.append(title, close); panel.append(top);
    const original = document.createElement('div'); original.className = 'source'; original.lang = this.settings().sourceLanguage; original.textContent = this.text; panel.append(original);
    const label = document.createElement('div'); label.className = 'label'; label.textContent = this.text.split(/\s+/u).length <= 3 ? '单词／短语直译' : '句子翻译'; panel.append(label);
    const result = document.createElement('div'); result.className = 'result'; result.setAttribute('role', 'status'); result.textContent = '正在查译…'; panel.append(result);
    const actions = document.createElement('div'); actions.className = 'actions'; panel.append(actions);
    const copy = (label: string, getText: () => string): void => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'copy'; button.textContent = label;
      button.addEventListener('click', () => { void navigator.clipboard.writeText(getText()).then(() => { button.textContent = '已复制'; }).catch(() => { button.textContent = '请选中文字复制'; }); }); actions.append(button);
    };
    copy('复制原文', () => this.text); copy('复制译文', () => this.translated);
    const note = document.createElement('div'); note.className = 'note'; note.textContent = '机器翻译 · 仅在本地处理'; panel.append(note);
    this.root!.replaceChildren(this.root!.querySelector('style')!, panel); this.position();
    return panel;
  }

  private async lookup(force = false): Promise<void> {
    if (!this.root || !this.text || !this.selectionCurrent()) { this.close(); return; }
    this.abort?.abort(); this.abort = new AbortController();
    const controller = this.abort, text = this.text, source = this.settings().sourceLanguage;
    const panel = this.panel(), result = panel.querySelector<HTMLElement>('.result')!;
    try {
      if (!force) {
        let evidence = classify(await this.engine().detect(text, controller.signal), source);
        if (evidence.result === 'unknown' && this.context) evidence = classify(await this.engine().detect(this.context, controller.signal), source);
        if (evidence.result !== 'match') {
          result.textContent = '无法确认所选文字是当前源语言。';
          const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = `仍按${LANGUAGES.find(l => l.code === source)?.label}查译`;
          confirm.addEventListener('click', () => { void this.lookup(true); }); result.append(document.createElement('br'), confirm); this.position(); return;
        }
      }
      const translated = await this.engine().translate(text, controller.signal);
      if (controller.signal.aborted || this.text !== text || this.abort !== controller) return;
      if (!this.selectionCurrent()) { this.close(); return; }
      this.translated = translated; result.textContent = translated;
      if (this.context) {
        const reference = document.createElement('button'); reference.className = 'copy'; reference.type = 'button'; reference.textContent = '查看原句参考';
        reference.addEventListener('click', () => {
          reference.disabled = true;
          void this.engine().translate(this.context, controller.signal).then(value => {
            if (controller.signal.aborted || this.abort !== controller) return;
            if (!this.selectionCurrent()) { this.close(); return; }
            const node = document.createElement('div'); node.className = 'context'; node.textContent = `原句参考\n${this.context}\n${value}`; reference.replaceWith(node); this.position();
          }).catch(() => { reference.disabled = false; reference.textContent = '原句参考未完成，点击重试'; });
        }); panel.querySelector('.note')!.before(reference);
      }
      this.position();
    } catch (error) {
      if (!controller.signal.aborted) { result.textContent = error instanceof Error && error.message === 'needs_download' ? '需要先从阅读设置中准备语言包。' : '查译未完成，请稍后重试。'; this.position(); }
    }
  }

  private selectionCurrent(): boolean {
    return location.href === this.sourceURL && !!this.range?.startContainer.isConnected
      && !!this.range.endContainer.isConnected && this.range.toString().trim() === this.text;
  }

  close(restoreFocus = false): void {
    clearTimeout(this.timer); this.abort?.abort(); this.host?.remove(); this.host = undefined; this.root = undefined;
    this.range = undefined; this.text = ''; this.context = ''; this.translated = '';
    if (restoreFocus && this.previousFocus instanceof HTMLElement) this.previousFocus.focus({ preventScroll: true });
  }
}
