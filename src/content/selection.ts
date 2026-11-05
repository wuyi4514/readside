import type { DocumentEngine } from '../providers/pool';
import { apiLanguage, languageLabel, LANGUAGES, type Settings, type SourceLanguage } from '../shared/settings';
import { classify, classifyLookup } from './language';
import { SENSITIVE, sourceText } from './extractor';

const CSS = `:host{all:initial;position:fixed;z-index:2147483647;display:block;color-scheme:light dark;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:13px;color:#202124;line-height:1.65}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0;border-radius:6px;padding:6px 10px;background:#25272c;color:#ffffff}button:focus-visible{outline:2px solid #3266e8;outline-offset:3px}.panel{width:min(320px,calc(100vw - 24px));padding:17px;background:#ffffff;box-shadow:0 4px 25px #10182826;border:1px solid #e6e8ec;border-radius:11px}.top{display:flex;justify-content:space-between;align-items:center;color:#666b74;font-size:10px;letter-spacing:.3px}.close{color:inherit;background:none;font-size:19px;padding:0 4px}.source{font-family:inherit;font-size:16px;margin:13px 0 8px;white-space:pre-wrap;max-height:150px;overflow:auto;overflow-wrap:anywhere}.result{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:210px;overflow:auto;margin-top:5px}.label{font-size:10px;color:#666b74;margin-top:12px}.actions{display:flex;gap:13px;align-items:center;margin-top:13px}.copy{padding:0;background:none;color:#25272c;font-size:11px}.copy:disabled{opacity:.45;cursor:default}.note{font-size:10px;color:#666b74;margin-top:13px;border-top:1px solid #e6e8ec;padding-top:9px} @media(prefers-color-scheme:dark){:host{color:#eeeef0}.panel{background:#222428;border-color:#4b505b}.top,.label,.note{color:#a4a9b3}.copy{color:#c5d5ff}.note{border-color:#363941}button{background:#ebedf2;color:#202228}.close{background:none;color:#a4a9b3}}`;

export class SelectionLookup {
  private host?: HTMLElement;
  private abort?: AbortController;
  private range?: Range;
  private rangeText = '';
  private text = '';
  private context = '';
  private previousFocus?: Element | null;
  private translated = '';
  private timer = 0;
  private root?: ShadowRoot;
  private sourceURL = '';
  constructor(private engine: () => DocumentEngine, private settings: () => Settings) {
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
    if (!text || text.length > 4000) { this.close(); return; }
    this.close(); this.range = range.cloneRange(); this.rangeText = this.range.toString(); this.text = text; this.sourceURL = location.href;
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

  private panel(source: SourceLanguage): HTMLElement {
    const panel = document.createElement('section'); panel.className = 'panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '词句查译'); panel.lang = 'zh-CN';
    const top = document.createElement('div'); top.className = 'top';
    const title = document.createElement('span'); title.textContent = `${LANGUAGES.find(l => l.code === source)?.label ?? ''} → ${languageLabel(this.settings().targetLanguage)}`;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭查译'); close.addEventListener('click', () => this.close(true));
    top.append(title, close); panel.append(top);
    const original = document.createElement('div'); original.className = 'source'; original.lang = source; original.textContent = this.text; panel.append(original);
    const label = document.createElement('div'); label.className = 'label'; label.textContent = this.text.split(/\s+/u).length <= 3 ? '单词／短语直译' : '句子翻译'; panel.append(label);
    const result = document.createElement('div'); result.className = 'result'; result.lang = this.settings().targetLanguage; result.setAttribute('role', 'status'); result.textContent = '正在查译…'; panel.append(result);
    const actions = document.createElement('div'); actions.className = 'actions'; panel.append(actions);
    const copy = (label: string, getText: () => string, translated = false): void => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'copy'; button.textContent = label;
      if (translated) { button.dataset.copyTranslation = ''; button.disabled = true; }
      button.addEventListener('click', () => { void navigator.clipboard.writeText(getText()).then(() => { button.textContent = '已复制'; }).catch(() => { button.textContent = '请选中文字复制'; }); }); actions.append(button);
    };
    copy('复制原文', () => this.text); copy('复制译文', () => this.translated, true);
    const note = document.createElement('div'); note.className = 'note'; note.textContent = this.settings().provider === 'chrome-local' ? '机器翻译 · 仅在本地处理' : `机器翻译 · ${this.settings().provider === 'google' ? 'Google' : 'Microsoft'}`; panel.append(note);
    this.root!.replaceChildren(this.root!.querySelector('style')!, panel); this.position();
    return panel;
  }

  private async lookup(force?: SourceLanguage): Promise<void> {
    if (!this.root || !this.text || !this.selectionCurrent()) { this.close(); return; }
    this.abort?.abort(); this.abort = new AbortController();
    const controller = this.abort, text = this.text;
    this.translated = '';
    let source = force ?? this.settings().sourceLanguages[0]!;
    const panel = this.panel(source), result = panel.querySelector<HTMLElement>('.result')!;
    try {
      if (this.settings().sourceLanguages.every(language => language === this.settings().targetLanguage)) { result.textContent = '源语言和目标语言相同，无需翻译。'; return; }
      if (!force) {
        const ranking = await this.engine().detect(text, controller.signal);
        let evidence = classifyLookup(ranking, source);
        if (evidence.result === 'unknown' && this.context) evidence = classify(await this.engine().detect(this.context, controller.signal), source);
        if (controller.signal.aborted || this.abort !== controller || !this.selectionCurrent()) return;
        const sources = this.settings().sourceLanguages.filter(language => language !== this.settings().targetLanguage);
        const detected = sources.find(language => apiLanguage(language) === evidence.language);
        if (detected && detected !== this.settings().targetLanguage) {
          source = detected;
          panel.querySelector('.top span')!.textContent = `${LANGUAGES.find(l => l.code === source)?.label} → ${languageLabel(this.settings().targetLanguage)}`;
          (panel.querySelector('.source') as HTMLElement).lang = source;
        } else {
          result.textContent = '无法确认所选文字属于已选源语言。';
          for (const language of this.settings().sourceLanguages.filter(l => l !== this.settings().targetLanguage)) {
            const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = `按${LANGUAGES.find(l => l.code === language)?.label}查译`;
            confirm.addEventListener('click', () => { void this.lookup(language); }); result.append(document.createElement('br'), confirm);
          }
          this.position(); return;
        }
      }
      // Translate paragraphs separately: native engines can flatten line breaks,
      // and a long selection should not become one oversized provider request.
      const chunks = lookupChunks(text), translated: string[] = [];
      for (const [index, chunk] of chunks.entries()) {
        controller.signal.throwIfAborted();
        if (this.abort !== controller || !this.selectionCurrent()) { this.close(); return; }
        result.textContent = chunks.length > 1 ? `正在查译（${index + 1}/${chunks.length}）…` : '正在查译…';
        const value = await this.engine().translate(chunk.text, source, controller.signal);
        if (!value.trim()) throw new Error('translation_failed');
        translated.push(chunk.separator + value.trim());
      }
      if (controller.signal.aborted || this.text !== text || this.abort !== controller) return;
      if (!this.selectionCurrent()) { this.close(); return; }
      this.translated = translated.join(''); result.textContent = this.translated;
      panel.querySelector<HTMLButtonElement>('[data-copy-translation]')!.disabled = false;
      this.position();
    } catch (error) {
      if (!controller.signal.aborted && this.abort === controller) {
        if (!this.selectionCurrent()) { this.close(); return; }
        result.textContent = lookupError(error);
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'copy'; retry.textContent = '重试';
        retry.addEventListener('click', () => { void this.lookup(source); });
        panel.querySelector('.actions')!.append(retry); this.position();
      }
    }
  }

  private selectionCurrent(): boolean {
    return location.href === this.sourceURL && !!this.range?.startContainer.isConnected
      // Range uses DOM whitespace; Selection.toString() uses rendered whitespace.
      // Compare the same representation over time, while translating what was selected.
      && !!this.range.endContainer.isConnected && this.range.toString() === this.rangeText;
  }

  close(restoreFocus = false): void {
    clearTimeout(this.timer); this.abort?.abort(); this.host?.remove(); this.host = undefined; this.root = undefined;
    this.range = undefined; this.rangeText = ''; this.text = ''; this.context = ''; this.translated = '';
    if (restoreFocus && this.previousFocus instanceof HTMLElement) this.previousFocus.focus({ preventScroll: true });
  }
}

function lookupChunks(text: string): Array<{ text: string; separator: string }> {
  const chunks: Array<{ text: string; separator: string }> = [];
  let separator = '';
  for (const part of text.split(/(\n+)/u)) {
    if (/^\n+$/u.test(part)) { separator += part; continue; }
    let remaining = part.trim();
    while (remaining) {
      let cut = remaining.length;
      if (cut > 600) {
        const prefix = remaining.slice(0, 600);
        const sentence = [...prefix.matchAll(/[.!?。！？](?:\s+|$)/gu)].at(-1);
        const space = [...prefix.matchAll(/\s+/gu)].at(-1);
        cut = sentence && sentence.index! >= 200 ? sentence.index! + sentence[0].length : space && space.index! >= 200 ? space.index! : 600;
        // Keep surrogate pairs intact when a language has no word boundaries.
        if (/[\uD800-\uDBFF]/u.test(remaining[cut - 1]!)) cut--;
      }
      chunks.push({ text: remaining.slice(0, cut).trim(), separator });
      remaining = remaining.slice(cut).trimStart(); separator = remaining ? ' ' : '';
    }
  }
  return chunks;
}

function lookupError(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  const code = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (code === 'needs_download') return '需要先从阅读设置中准备语言包。';
  if (code === 'unsupported_pair') return '当前翻译服务不支持这个语言方向，请更换翻译服务。';
  if (code === 'unsupported_browser') return '当前浏览器不支持本地翻译，可在设置中更换翻译服务。';
  if (code === 'online_permission') return '请先在插件设置中允许使用当前翻译服务。';
  if (code === 'online_rate_limit' || code === 'online_busy') return '翻译服务暂时繁忙，请稍后重试。';
  if (name === 'TimeoutError' || code === 'timeout') return '查译超时，请重试。';
  if (name === 'QuotaExceededError') return '本地翻译暂时繁忙，请稍后重试。';
  if (name === 'InvalidStateError' || name === 'AbortError') return '本地翻译连接已中断，请重试。';
  return '查译未完成，请重试，或在设置中更换翻译服务。';
}
