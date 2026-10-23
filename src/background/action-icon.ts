import logo from '../../assets/icons/48.png';
import type { PageStatus } from '../shared/messages';

const revisions = new Map<number, number>();
let bitmap: Promise<ImageBitmap> | undefined;
const paths = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png' };

async function workingIcon(): Promise<Record<number, ImageData>> {
  bitmap ??= createImageBitmap(new Blob([new Uint8Array(logo)], { type: 'image/png' }));
  const mark = await bitmap; const icons: Record<number, ImageData> = {};
  for (const size of [16, 32, 48]) {
    const canvas = new OffscreenCanvas(size, size); const context = canvas.getContext('2d')!;
    const scale = size / 16; context.scale(scale, scale);
    context.lineWidth = 1.4; context.lineCap = 'round';
    context.strokeStyle = '#dce4fb'; context.beginPath(); context.arc(8, 8, 7, 0, Math.PI * 2); context.stroke();
    context.strokeStyle = '#3266e8'; context.beginPath(); context.arc(8, 8, 7, -Math.PI / 2, Math.PI * .85); context.stroke();
    context.drawImage(mark, 2.2, 2.2, 11.6, 11.6); icons[size] = context.getImageData(0, 0, size, size);
  }
  return icons;
}
let working: ReturnType<typeof workingIcon> | undefined;
export async function updateAction(tabId: number, status: PageStatus): Promise<void> {
  const revision = (revisions.get(tabId) ?? 0) + 1; revisions.set(tabId, revision);
  const labels: Record<PageStatus['state'], string> = {
    working: `正在翻译 · 已完成 ${status.translated} 块`, ready: `已翻译 ${status.translated} 块`,
    partial: '部分内容未完成，请打开弹窗查看', 'needs-download': '请先准备翻译方向', unsupported: '此页面或语言暂不支持',
    off: '自动翻译已关闭', paused: '此页已恢复原文',
  };
  const imageData = status.state === 'working' ? await (working ??= workingIcon()) : undefined;
  if (revisions.get(tabId) !== revision) return;
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: '' }),
    chrome.action.setTitle({ tabId, title: `Readside · ${labels[status.state] ?? '网页对照翻译'}` }),
    chrome.action.setIcon(imageData ? { tabId, imageData } : { tabId, path: paths }),
  ]);
}
export function forgetAction(tabId: number): void { revisions.delete(tabId); }
