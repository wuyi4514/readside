import type { Settings } from '../shared/settings';
import { backgroundFor, parseColor, secondaryColor } from './color';
import { OWNED } from './extractor';

const CONTROLS = 'button,nav,label,time,td,th,[role="button"],[role="menu"],[role="navigation"],[role="toolbar"],[role="tab"]';
function compact(source: HTMLElement): boolean {
  return !!source.closest(CONTROLS) || source.matches('a') || ['inline', 'inline-block', 'inline-flex', 'table-cell'].includes(getComputedStyle(source).display);
}
const originalOverlap = new WeakMap<HTMLElement, Map<Element, number>>();
const originalOverflow = new WeakMap<HTMLElement, Map<Element, number>>();
const clamped = (style: CSSStyleDeclaration): boolean => !!style.webkitLineClamp && !['none', '0'].includes(style.webkitLineClamp);
const verticalFlow = (style: CSSStyleDeclaration): boolean => ['block', 'flow-root', 'list-item'].includes(style.display)
  || (['flex', 'inline-flex'].includes(style.display) && style.flexDirection === 'column');

function placement(source: HTMLElement): { parent: HTMLElement; after: boolean } | null {
  if (!clamped(getComputedStyle(source))) return { parent: source, after: false };
  const parent = source.parentElement;
  // Keep the original clamp intact. A sibling translation is safe only where
  // the parent lays content out vertically and can grow naturally.
  return parent && verticalFlow(getComputedStyle(parent)) ? { parent, after: true } : null;
}

export function safeContainer(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const own = getComputedStyle(element);
  if (['flex', 'inline-flex'].includes(own.display) && own.flexDirection !== 'column' && !compact(element)) return false;
  if (['grid', 'inline-grid', 'table', 'table-row'].includes(own.display)) return false;
  const target = placement(element); if (!target) return false;
  for (let node: HTMLElement | null = target.parent, i = 0; node && i < 5; node = node.parentElement, i++) {
    const style = getComputedStyle(node);
    if (clamped(style)) return false;
    if (!compact(element) && ['hidden', 'clip'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return false;
  }
  return true;
}

function setStyle(node: HTMLElement, values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) if (node.style.getPropertyValue(key) !== value || node.style.getPropertyPriority(key) !== 'important') node.style.setProperty(key, value, 'important');
}

export function styleTranslation(node: HTMLElement, source: HTMLElement, settings: Settings): void {
  const style = getComputedStyle(source);
  const originalSize = parseFloat(style.fontSize) || 16;
  const title = source.matches('h1,h2,h3,h4,h5,h6,[role="heading"]') || originalSize >= 24;
  const size = title ? Math.max(settings.minimumTranslationFontPx, Math.min(18, originalSize * 0.72)) : Math.max(settings.minimumTranslationFontPx, originalSize * settings.translationScale);
  const foreground = parseColor(style.color) ?? [32, 37, 33];
  const inline = compact(source);
  setStyle(node, {
    display: inline ? 'inline' : 'block', 'font-size': `${size}px`, 'line-height': '1.6', 'font-weight': '400',
    'font-family': style.fontFamily, 'font-style': 'normal', 'letter-spacing': 'normal',
    'text-transform': 'none', 'text-decoration': 'none', 'text-align': style.textAlign,
    color: secondaryColor(foreground, backgroundFor(node.parentElement ?? placement(source)?.parent ?? source)), opacity: '1',
    margin: inline ? '0 0 0 .4em' : '5px 0 0', padding: '0', border: '0', background: 'transparent',
    position: 'static', float: 'none', width: 'auto', height: 'auto', 'min-width': '0',
    'white-space': inline ? 'nowrap' : 'pre-line', 'flex-shrink': inline ? '0' : '1', 'overflow-wrap': 'anywhere', 'word-break': 'normal',
    visibility: 'visible', 'user-select': 'text', 'max-height': 'none',
    transition: 'none', animation: 'none', '-webkit-text-fill-color': 'currentColor',
  });
}

export function layoutFits(source: HTMLElement, translation: HTMLElement, documentWidth = Math.max(innerWidth, document.documentElement.scrollWidth)): boolean {
  const rect = translation.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  // A carousel can intentionally extend past the viewport. Translation must fit
  // its text container, rather than requiring the entire card to be onscreen.
  if (rect.width <= 0 || rect.height <= 0 || rect.left < sourceRect.left - 2 || rect.right > sourceRect.right + 2) return false;
  for (let node: HTMLElement | null = translation.parentElement, i = 0; node && i < 5; node = node.parentElement, i++) {
    const style = getComputedStyle(node), outer = node.getBoundingClientRect();
    const overflow = originalOverflow.get(translation)?.get(node) ?? 0;
    if (['hidden', 'clip'].includes(style.overflowY) && (rect.bottom > outer.bottom + 1 || node.scrollHeight > node.clientHeight + Math.max(1, overflow) + 1)) return false;
    const next = node.nextElementSibling;
    if (next && !next.matches(OWNED)) {
      const sibling = next.getBoundingClientRect();
      const allowance = originalOverlap.get(translation)?.get(node) ?? 0;
      if (rect.bottom > sibling.top + allowance + 1 && rect.top < sibling.bottom && rect.right > sibling.left && rect.left < sibling.right) return false;
    }
  }
  const next = translation.nextElementSibling;
  if (translation.parentElement !== source && next && !next.matches(OWNED)) {
    const sibling = next.getBoundingClientRect();
    const allowance = originalOverlap.get(translation)?.get(source) ?? 0;
    if (rect.bottom > sibling.top + allowance + 1 && rect.top < sibling.bottom && rect.right > sibling.left && rect.left < sibling.right) return false;
  }
  return document.documentElement.scrollWidth <= documentWidth + 2;
}

export function layoutFingerprint(source: HTMLElement): string {
  const parts: Array<string | number> = [innerWidth];
  for (let node: HTMLElement | null = source, i = 0; node && i < 5; node = node.parentElement, i++) {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    parts.push(Math.round(rect.left), Math.round(rect.width), Math.round(rect.height), node.clientHeight, node.scrollHeight,
      style.display, style.position, style.overflowY, style.webkitLineClamp);
  }
  return parts.join('|');
}

export function renderTranslation(source: HTMLElement, text: string, settings: Settings): HTMLElement | null {
  if (!safeContainer(source)) return null;
  const translation = document.createElement('span');
  translation.dataset.prOwned = 'translation'; translation.lang = settings.targetLanguage; translation.translate = false;
  // Keep an existing whole-card link's accessible name identical to its original.
  if (source.closest('a,button,[role="link"],[role="button"],[role="tab"]')) translation.setAttribute('aria-hidden', 'true');
  translation.textContent = text; styleTranslation(translation, source, settings);
  const documentWidth = Math.max(innerWidth, document.documentElement.scrollWidth);
  const target = placement(source)!;
  // Some vertical layouts intentionally use negative margins. Preserve that
  // existing geometry; reject additional overlap introduced by translation.
  const baseline = new Map<Element, number>();
  const overflow = new Map<Element, number>();
  for (let node: HTMLElement | null = target.after ? source : target.parent, i = 0; node && i < 6; node = node.parentElement, i++) {
    overflow.set(node, Math.max(0, node.scrollHeight - node.clientHeight));
    const next = node.nextElementSibling;
    if (next && !next.matches(OWNED)) {
      const rect = node.getBoundingClientRect(), sibling = next.getBoundingClientRect();
      if (rect.top < sibling.bottom && rect.right > sibling.left && rect.left < sibling.right) baseline.set(node, Math.max(0, rect.bottom - sibling.top));
    }
  }
  originalOverlap.set(translation, baseline);
  originalOverflow.set(translation, overflow);
  if (target.after) source.after(translation); else source.append(translation);
  if (!layoutFits(source, translation, documentWidth)) { translation.remove(); return null; }
  return translation;
}
