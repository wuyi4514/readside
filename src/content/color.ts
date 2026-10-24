export type RGB = [number, number, number];
interface Paint { rgb: RGB; alpha: number }
const paints = new Map<string, Paint | null>();
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function paint(value: string): Paint | null {
  if (paints.has(value)) return paints.get(value)!;
  const rgb = value.match(/^rgba?\((.*)\)$/i);
  const srgb = value.match(/^color\(srgb\s+(.+)\)$/i);
  let result: Paint | null = null;
  if (rgb || srgb) {
    const parts = (rgb?.[1] ?? srgb![1]!).trim().split(/[\s,/]+/u);
    if (parts.length === 3 || parts.length === 4) {
      const channel = (text: string) => clamp(parseFloat(text) / (text.endsWith('%') ? 100 : srgb ? 1 : 255)) * 255;
      const alpha = parts[3] ? clamp(parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1)) : 1;
      const channels = parts.slice(0, 3).map(channel) as RGB;
      if ([...channels, alpha].every(Number.isFinite)) result = { rgb: channels, alpha };
    }
  } else if (value === 'transparent') result = { rgb: [0, 0, 0], alpha: 0 };
  else if (typeof OffscreenCanvas !== 'undefined' && CSS.supports('color', value)) {
    // Resolve modern computed colors (e.g. oklch) in the browser's sRGB canvas.
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (context) {
      context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      result = { rgb: [r!, g!, b!], alpha: a! / 255 };
    }
  }
  if (paints.size >= 256) paints.delete(paints.keys().next().value!);
  paints.set(value, result); return result;
}
export function parseColor(value: string): RGB | null {
  const parsed = paint(value); return parsed && parsed.alpha > 0 ? parsed.rgb : null;
}
function luminance(color: RGB): number {
  const linear = color.map(c => { const n = c / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
export function contrast(a: RGB, b: RGB): number {
  const l1 = luminance(a), l2 = luminance(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export function secondaryColor(foreground: RGB, background: RGB): string {
  let color = foreground;
  for (let amount = 0.64; amount <= 1.001; amount += 0.04) {
    const mixed = foreground.map((v, i) => Math.round(v * amount + background[i]! * (1 - amount))) as RGB;
    if (contrast(mixed, background) >= 4.5) { color = mixed; break; }
  }
  if (contrast(color, background) < 4.5) color = contrast([0, 0, 0], background) > contrast([255, 255, 255], background) ? [0, 0, 0] : [255, 255, 255];
  return `rgb(${color.join(', ')})`;
}

export function backgroundFor(element: Element): RGB {
  const color: RGB = [0, 0, 0]; let coverage = 0;
  for (let node: Element | null = element; node && coverage < 1; node = node.parentElement) {
    const layer = paint(getComputedStyle(node).backgroundColor);
    if (!layer) continue;
    const alpha = layer.alpha * (1 - coverage);
    for (let i = 0; i < 3; i++) color[i]! += layer.rgb[i]! * alpha;
    coverage += alpha;
  }
  // A transparent document uses its canvas color scheme, not the OS preference
  // alone: a light page can remain light while the OS prefers dark.
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  const dark = scheme === 'dark' || (scheme.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches);
  const canvas = dark ? 18 : 255;
  return color.map(channel => Math.round(channel + canvas * (1 - coverage))) as RGB;
}
