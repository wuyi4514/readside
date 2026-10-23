export type RGB = [number, number, number];
export function parseColor(value: string): RGB | null {
  const values = value.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length < 3 || (values.length > 3 && values[3] === 0)) return null;
  return [values[0]!, values[1]!, values[2]!];
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
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const parsed = parseColor(style.backgroundColor);
    if (parsed) return parsed;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? [29, 37, 33] : [255, 255, 255];
}
