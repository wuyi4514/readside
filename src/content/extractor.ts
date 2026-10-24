export const OWNED = '[data-pr-owned]';
export const SENSITIVE = 'script,style,noscript,template,pre,svg,canvas,iframe,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="log"],[hidden],[aria-hidden="true"],[translate="no"],.notranslate,[data-pr-owned]';
const EXCLUDED = SENSITIVE;
const STRUCTURE = 'html,body,main,nav,header,footer,aside,section,article,ul,ol,dl,table,thead,tbody,tfoot,tr,form,[role="navigation"],[role="menu"],[role="menubar"],[role="toolbar"],[role="list"]';
const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,[role="heading"]';
const NESTED = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,[role="heading"]';

export function excludedFromTranslation(element: Element): boolean { return !!element.closest(EXCLUDED); }

export function sourceText(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null;
  const pieces: string[] = [];
  while ((node = walker.nextNode())) {
    const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element;
    if (!parent || parent.closest(SENSITIVE)) continue;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName === 'BR') pieces.push('\n');
      continue;
    }
    let visible = true;
    for (let current: Element | null = parent; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') { visible = false; break; }
      if (current === root) break;
    }
    if (visible) pieces.push(node.textContent ?? '');
  }
  return pieces.join('').replace(/\s+/gu, ' ').trim();
}

export function sourceLanguageHint(element: Element): string | undefined {
  const explicit = element.closest('[lang]');
  if (!explicit || ['HTML', 'BODY'].includes(explicit.tagName)) return undefined;
  return explicit.getAttribute('lang')?.toLowerCase().split('-')[0];
}

export function nearViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top < innerHeight * 2 && rect.left < innerWidth && rect.right > 0;
}

export function isCandidate(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.closest(EXCLUDED)) return false;
  if (element.matches(STRUCTURE) || element.querySelector(NESTED)) return false;
  if (element.matches(BLOCKS)) return true;
  // Flow content, including custom elements, is recognized by layout rather than
  // by a site's domain, private classes, test attributes or framework component.
  if (element.matches('img,video,audio,br,hr,wbr')) return false;
  const style = getComputedStyle(element);
  const column = ['flex', 'inline-flex'].includes(style.display) && style.flexDirection === 'column';
  if (!column && !['block', 'flow-root', 'list-item', 'inline-block', 'inline', 'table-cell', ''].includes(style.display) && !element.matches('button,a,[role="button"],[role="tab"]')) return false;
  if ([...element.children].some(child => !child.matches(OWNED) && !child.matches(SENSITIVE)
    && !['inline', 'contents', 'inline-block'].includes(getComputedStyle(child).display)
    && !(column && child.matches('span,strong,em,b,i,small,a,code,br')))) return false;
  return /\p{L}/u.test(sourceText(element));
}

/** Wrap otherwise orphaned visible text; restore these wrappers when reading stops. */
function ownTextRuns(root: Element): void {
  const nodes = [root, ...root.querySelectorAll('*')];
  for (const element of nodes) {
    if (element.closest(EXCLUDED) || isCandidate(element)) continue;
    for (const node of [...element.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !/\p{L}/u.test(node.textContent ?? '')) continue;
      const wrapper = document.createElement('span'); wrapper.dataset.prSource = '';
      node.before(wrapper); wrapper.append(node);
    }
  }
}
export function restoreSourceRuns(): void {
  for (const wrapper of document.querySelectorAll('[data-pr-source]')) wrapper.replaceWith(...wrapper.childNodes);
}

/** A text-node mutation may arrive inside inline markup, below its reading block. */
export function readingRoot(element: Element): Element {
  for (let node: Element | null = element, i = 0; node && i < 6; node = node.parentElement, i++) {
    if (isCandidate(node)) return node;
    if (node.matches(STRUCTURE) || node.matches(EXCLUDED)) break;
  }
  return element;
}

export function* candidates(root: Element): Generator<HTMLElement> {
  if (root.closest(EXCLUDED)) return;
  ownTextRuns(root);
  if (isCandidate(root)) { yield root; return; }
  const selected = new WeakSet<Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: node => (node as Element).matches(EXCLUDED) || (node.parentElement && selected.has(node.parentElement)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node: Node | null;
  while ((node = walker.nextNode())) if (isCandidate(node as Element)) { selected.add(node as Element); yield node as HTMLElement; }
}

export function contextFor(element: HTMLElement): string {
  const parent = element.parentElement;
  if (!parent) return '';
  const local = sourceText(parent);
  if (!parent.matches(STRUCTURE) && local !== sourceText(element) && local.length >= 40 && local.length <= 2000) return local;
  // Navigation words alone are too short for language identification. Use one
  // nearby reading paragraph, rather than concatenating every language on a page.
  const scope = element.closest('article,main') ?? document.querySelector('main,article') ?? document.body;
  for (const paragraph of scope.querySelectorAll('p,blockquote')) {
    if (excludedFromTranslation(paragraph)) continue;
    const text = sourceText(paragraph);
    if (text.length >= 40 && text.length <= 2000) return text;
  }
  const nearby = sourceText(scope);
  return nearby.length >= 40 && nearby.length <= 2000 ? nearby : '';
}

const ownerIds = new WeakMap<Element, number>();
let nextOwnerId = 0;
export function entryKey(element: Element): string {
  const owner = element.closest('article,[role="article"],li,[role="listitem"]');
  if (!owner) return '';
  if (!ownerIds.has(owner)) ownerIds.set(owner, ++nextOwnerId);
  const bookmark = owner.querySelector<HTMLAnchorElement>('a[rel~="bookmark"]');
  const time = owner.querySelector('time');
  const identity = bookmark?.getAttribute('href') ?? time?.closest('a')?.getAttribute('href') ?? time?.getAttribute('datetime') ?? '';
  return `${ownerIds.get(owner)}:${identity}`;
}
