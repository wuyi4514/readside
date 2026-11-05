import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Exercise the production renderer in a real layout engine, without translators,
// network requests, extension permissions or the user's browser profile.
const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root, '.private/wrapping');
await mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: { contents: 'export { renderTranslation, styleTranslation, layoutFits } from "./src/content/renderer"; export { DEFAULT_SETTINGS } from "./src/shared/settings";', resolveDir: root },
  bundle: true, write: false, format: 'iife', globalName: 'readside',
});
const defaults = { darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', linux: '/usr/bin/google-chrome', win32: `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe` };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? defaults[process.platform], headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.setContent(`<style>
    *{box-sizing:border-box}body{margin:24px;font:18px/1.6 Arial;color:#17191c}
    .post{width:500px;max-width:100%;overflow:hidden;white-space:pre-wrap;margin-bottom:24px}
    nav{display:flex;gap:12px}button{display:flex;align-items:center;height:36px;overflow:hidden;white-space:nowrap;font:14px Arial;padding:4px 12px}
    p{margin:0}svg{flex:none;width:12px;height:12px}
  </style><main>
    <article class="post"><span id="inline">A long post can include several paragraphs and still remain easy to read.</span></article>
    <article class="post" role="button"><p id="card">Reading inside a clickable card should keep the translation within the text column.</p></article>
    <article class="post"><span id="address">A longer address can be useful in a reading example.</span></article>
    <nav><button id="control" type="button">Research<svg aria-hidden="true"><path d="M2 4L6 8L10 4"/></svg></button></nav>
  </main>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const translated = '这段译文应该按照阅读区域的宽度自然换行，让每一行的内容完整可见，不能溢出或被裁切。'.repeat(4);
  await page.evaluate(text => {
    window.originalText = document.querySelector('#inline').textContent;
    for (const id of ['inline', 'card', 'address', 'control']) {
      const value = id === 'control' ? '研究' : id === 'address' ? 'https://example.com/' + 'a'.repeat(250) : text + '\n\n这是下一段译文。';
      const source = document.getElementById(id);
      const node = readside.renderTranslation(source, value, readside.DEFAULT_SETTINGS);
      if (!node) throw new Error(`Missing translation: ${id}`);
    }
    window.clicks = 0;
    document.getElementById('control').onclick = () => window.clicks++;
  }, translated);

  for (const width of [900, 360, 700]) {
    await page.setViewportSize({ width, height: 1000 });
    const geometry = await page.evaluate(() => {
      const results = [];
      for (const id of ['inline', 'card', 'address']) {
        const source = document.getElementById(id), node = source.querySelector('[data-pr-owned]');
        readside.styleTranslation(node, source, readside.DEFAULT_SETTINGS);
        const bounds = source.closest('.post').getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(node);
        const lines = [...range.getClientRects()].filter(rect => rect.width > 0);
        results.push({ id, lines: lines.length, fits: lines.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1), whiteSpace: getComputedStyle(node).whiteSpace });
      }
      return { results, overflow: document.documentElement.scrollWidth > innerWidth + 1, original: document.querySelector('#inline').firstChild.textContent === window.originalText };
    });
    for (const item of geometry.results) {
      assert.ok(item.fits, `${item.id} overflows at ${width}px: ${JSON.stringify(item)}`);
      assert.ok(item.lines > 1, `${item.id} does not wrap at ${width}px`);
    }
    assert.equal(geometry.overflow, false); assert.equal(geometry.original, true);
    console.log(`PASS: wrapped inline text, clickable card and long address at ${width}px`);
    if (width === 360) await page.screenshot({ path: path.join(evidence, 'wrapped-narrow.png'), fullPage: true });
  }
  await page.locator('#control').click();
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.equal(await page.locator('#control svg').count(), 1);
  assert.equal(await page.locator('#control').evaluate(node => node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1), true);
  await page.screenshot({ path: path.join(evidence, 'wrapped-desktop.png'), fullPage: true });
  console.log('PASS: compact control retains its size, icon and click handler');
} finally { await browser.close(); }
