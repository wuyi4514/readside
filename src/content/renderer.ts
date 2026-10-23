import type { Settings } from '../shared/settings';
import { backgroundFor, parseColor, secondaryColor } from './color';
import { OWNED } from './extractor';

const CONTROLS = 'button,nav,[role="button"],[role="menu"],[role="navigation"],[role="toolbar"],[role="tab"]';

export function safeContainer(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest(CONTROLS)) return false;
  const cell = element.closest('td,th');
  if (cell && (cell.getBoundingClientRect().width < 320 || !element.matches('p,h1,h2,h3,h4,h5,h6,blockquote'))) return false;
  const own = getComputedStyle(element);
  if (['flex', 'inline-flex', 'grid', 'inline-grid', 'table', 'table-row', 'table-cell'].includes(own.display)) return false;
  for (let node: HTMLElement | null = element, i = 0; node && i < 5; node = node.parentElement, i++) {
    const style = getComputedStyle(node);
    if ((style.webkitLineClamp && style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '0') || ['absolute', 'fixed'].includes(style.position)) return false;
    if (['hidden', 'clip'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return false;
  }
  return true;
}

function setStyle(node: HTMLElement, values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) node.style.setProperty(key, value, 'important');
}

export function styleTranslation(node: HTMLElement, source: HTMLElement, settings: Settings): void {
  const style = getComputedStyle(source);
  const originalSize = parseFloat(style.fontSize) || 16;
  const title = source.matches('h1,h2,h3,h4,h5,h6,[role="heading"]');
  const size = title ? Math.max(settings.minimumTranslationFontPx, Math.min(18, originalSize * 0.72)) : Math.max(settings.minimumTranslationFontPx, originalSize * settings.translationScale);
  const foreground = parseColor(style.color) ?? [32, 37, 33];
  setStyle(node, {
    display: 'block', 'font-size': `${size}px`, 'line-height': '1.6', 'font-weight': '400',
    'font-family': 'inherit', 'font-style': 'normal', 'letter-spacing': 'normal',
    'text-transform': 'none', 'text-decoration': 'none', 'text-align': style.textAlign,
    color: secondaryColor(foreground, backgroundFor(source)), opacity: '1',
    margin: '5px 0 0', padding: '0', border: '0', background: 'transparent',
    position: 'static', float: 'none', width: 'auto', height: 'auto', 'min-width': '0',
    'white-space': 'pre-line', 'overflow-wrap': 'anywhere', 'word-break': 'normal',
    visibility: 'visible', 'user-select': 'text', 'max-height': 'none',
  });
}

export function layoutFits(source: HTMLElement, translation: HTMLElement): boolean {
  const rect = translation.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || rect.right > innerWidth + 2) return false;
  for (let node: HTMLElement | null = source, i = 0; node && i < 5; node = node.parentElement, i++) {
    const style = getComputedStyle(node), outer = node.getBoundingClientRect();
    if (['hidden', 'clip'].includes(style.overflowY) && (rect.bottom > outer.bottom + 1 || node.scrollHeight > node.clientHeight + 1)) return false;
    const next = node.nextElementSibling;
    if (next && !next.matches(OWNED)) {
      const sibling = next.getBoundingClientRect();
      if (rect.bottom > sibling.top + 1 && rect.top < sibling.bottom && rect.right > sibling.left && rect.left < sibling.right) return false;
    }
  }
  return document.documentElement.scrollWidth <= Math.max(innerWidth, document.documentElement.clientWidth) + 2;
}

export function renderTranslation(source: HTMLElement, text: string, settings: Settings): HTMLElement | null {
  if (!safeContainer(source)) return null;
  const translation = document.createElement('span');
  translation.dataset.prOwned = 'translation'; translation.lang = 'zh-CN'; translation.translate = false;
  // Keep an existing whole-card link's accessible name identical to its original.
  if (source.closest('a,[role="link"]')) translation.setAttribute('aria-hidden', 'true');
  translation.textContent = text; styleTranslation(translation, source, settings);
  source.append(translation);
  if (!layoutFits(source, translation)) { translation.remove(); return null; }
  return translation;
}
