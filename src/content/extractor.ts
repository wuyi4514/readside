export const OWNED = '[data-pr-owned]';
export const SENSITIVE = 'script,style,noscript,template,pre,svg,canvas,iframe,form,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="log"],[hidden],[aria-hidden="true"],[translate="no"],.notranslate,[data-pr-owned]';
const EXCLUDED = `${SENSITIVE},form,nav,button,[role="button"],[role="tab"],[role="navigation"],[role="menu"],[role="menubar"],[role="toolbar"]`;
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

function isCandidate(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.closest(EXCLUDED)) return false;
  if (element.querySelector(NESTED)) return false;
  if (element.matches(BLOCKS)) return true;
  // Flow content, including custom elements, is recognized by layout rather than
  // by a site's domain, private classes, test attributes or framework component.
  if (element.matches('html,body') || element.closest('header,time,address,[rel~="author"]')) return false;
  const style = getComputedStyle(element);
  const column = ['flex', 'inline-flex'].includes(style.display) && style.flexDirection === 'column';
  if (!column && !['block', 'flow-root', 'list-item', 'inline-block'].includes(style.display)) return false;
  if ([...element.children].some(child => !child.matches(OWNED) && !child.matches(SENSITIVE)
    && !['inline', 'contents', 'inline-block'].includes(getComputedStyle(child).display)
    && !(column && child.matches('span,strong,em,b,i,small,a,code,br')))) return false;
  return sourceText(element).length >= 30;
}

export function* candidates(root: Element): Generator<HTMLElement> {
  if (root.closest(EXCLUDED)) return;
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
  if (!parent || ['BODY', 'MAIN', 'HTML'].includes(parent.tagName) || parent.querySelectorAll('h1,h2,h3,h4,h5,h6').length > 1) return '';
  const context = sourceText(parent);
  return context.length <= 2000 ? context : '';
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
