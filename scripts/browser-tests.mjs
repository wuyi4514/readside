import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const evidenceDir = path.join(rootDir, '.private/browser-evidence');
await mkdir(evidenceDir, { recursive: true });
const endpoint = process.env.PR_CDP_URL ?? 'http://127.0.0.1:9327';
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const cdp = await browser.newBrowserCDPSession();
const results = [];
const errors = [];
const networks = new Set();
const server = http.createServer(async (req, res) => {
  const routes = { '/': 'reader.html', '/feed.html': 'feed.html', '/fixture.css': 'fixture.css', '/fixture.js': 'fixture.js' };
  const file = routes[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end(); return; }
  const body = await readFile(path.join(rootDir, 'tests/fixtures', file));
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript', 'content-security-policy': "default-src 'none'; style-src 'self'; script-src 'self'" });
  res.end(body);
});
await new Promise(resolve => server.listen(9329, '127.0.0.1', resolve));

async function check(name, fn) {
  const start = performance.now();
  await fn(); results.push({ name, status: 'passed', ms: Math.round(performance.now() - start) });
  console.log('PASS', name);
  await writeFile(path.join(evidenceDir, 'results.json'), JSON.stringify({ chrome: browser.version(), results, errors }, null, 2));
}

// Chrome action popups are not regular Playwright tabs. Attach to the actual
// popup target through CDP so these checks exercise its real current-tab UI.
async function actionPopup(page, extensionId) {
  await page.evaluate(() => history.replaceState(null, '', '#popup-test'));
  await page.bringToFront();
  const tab = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(t => t.url === page.url());
  assert.ok(tab);
  await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
  const deadline = Date.now() + 5000;
  let target;
  do {
    target = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url === `chrome-extension://${extensionId}/popup.html`);
    if (!target) await new Promise(resolve => setTimeout(resolve, 50));
  } while (!target && Date.now() < deadline);
  assert.ok(target);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let sequence = 0;
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { cdp.off('Target.receivedMessageFromTarget', listener); reject(new Error(`Popup command timed out: ${method}`)); }, 10000);
    const listener = event => {
      if (event.sessionId !== sessionId) return;
      const result = JSON.parse(event.message);
      if (result.id !== id) return;
      clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', listener);
      if (result.error) reject(new Error(result.error.message)); else resolve(result.result);
    };
    cdp.on('Target.receivedMessageFromTarget', listener);
    void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  const evaluate = async expression => {
    const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await command('Runtime.enable');
  // Wait for the popup's async settings initialization.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('!!document.querySelector("#auto") && !document.querySelector("#auto").disabled && document.querySelector("#site").textContent !== "当前页面"')) break;
    if (attempt === 99) throw new Error('Popup settings did not initialize');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { evaluate, command, close: () => cdp.send('Target.closeTarget', { targetId: target.targetId }) };
}

try {
  // Close only pages created by earlier runs in this isolated test profile.
  for (const page of context.pages()) {
    if (page.url().startsWith('http://127.0.0.1:9329/') || page.url().startsWith('chrome-extension://')) await page.close();
  }
  // Only the test manifest is pregranted. All runtime JS is the production build.
  // This isolates engine/DOM tests from Chrome's native permission prompt.
  const extensionPath = path.join(rootDir, '.private/test-extension');
  await cp(path.join(rootDir, 'dist'), extensionPath, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://*/*', 'http://127.0.0.1/*'];
  manifest.optional_host_permissions = [];
  await writeFile(path.join(extensionPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const extension of (await cdp.send('Extensions.getExtensions')).extensions) {
    if (extension.name.startsWith('Parallel Read')) await cdp.send('Extensions.uninstall', { id: extension.id });
  }
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  const options = await context.newPage();
  options.on('pageerror', error => errors.push(error.message));
  options.on('request', request => networks.add(request.url()));
  await options.goto(`chrome-extension://${id}/options.html`);
  await check('Local models available in installed extension', async () => {
    await options.waitForFunction(() => document.querySelector('#engine-state')?.textContent.includes('已就绪'), { }, { timeout: 20000 });
  });
  await options.screenshot({ path: path.join(evidenceDir, 'settings.png'), fullPage: true });
  await options.locator('#enable-all').click();
  await check('Enable switch persists to extension storage', async () => {
    await options.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings?.autoTranslate === true);
    assert.equal(await options.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.autoTranslate), true);
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => networks.add(request.url()));
  await page.goto('http://127.0.0.1:9329/');
  await check('Automatic real translation on strict-CSP page', async () => {
    await page.waitForSelector('#hero > [data-pr-owned="translation"]', { timeout: 30000 });
    assert.match(await page.locator('#hero > [data-pr-owned]').textContent(), /\p{Script=Han}/u);
  });
  await check('Cards receive separate title and paragraph translations', async () => {
    for (const selector of ['#title-a','#body-a','#title-b','#body-b','#title-c','#body-c']) await page.waitForSelector(`${selector} > [data-pr-owned="translation"]`, { timeout: 30000 });
  });
  await page.screenshot({ path: path.join(evidenceDir, 'reader-light.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: path.join(evidenceDir, 'reader-preview.png'), scale: 'css', clip: { x: 90, y: 125, width: 1260, height: 880 } });
  await check('French, Spanish, Chinese and protected content are untouched', async () => {
    await page.locator('#mixed').scrollIntoViewIfNeeded();
    await page.waitForSelector('#mixed > [data-pr-owned="translation"]', { timeout: 30000 });
    for (const selector of ['#french','#spanish','#chinese','#ignored','#compact','#draft','#hidden','nav','form']) assert.equal(await page.locator(`${selector} [data-pr-owned="translation"]`).count(), 0, selector);
  });
  await check('Inline nodes, links and original text remain intact', async () => {
    assert.equal(await page.locator('#emphasis').textContent(), 'focus on what matters');
    assert.equal(await page.locator('#inline-link').getAttribute('href'), '#team');
    assert.equal(await page.locator('#link-a').getAttribute('href'), '#details-a');
    assert.equal(await page.locator('#body-a').evaluate(node => node.childNodes[0].textContent), 'Bring your notes, plans, and projects together in one quiet space. Find the important details without losing the bigger picture.');
  });
  await check('Dynamically added paragraph is automatically translated', async () => {
    await page.locator('#append').click();
    await page.waitForSelector('#new-paragraph > [data-pr-owned="translation"]', { timeout: 30000 });
  });
  await check('Updated source receives a fresh translation', async () => {
    await page.locator('#body-a').scrollIntoViewIfNeeded();
    const old = await page.locator('#body-a > [data-pr-owned]').textContent();
    await page.locator('#replace').click();
    await page.locator('#body-a').scrollIntoViewIfNeeded();
    await page.waitForFunction(old => {const node=document.querySelector('#body-a > [data-pr-owned]');return node && node.textContent!==old;}, old, { timeout: 30000 });
    assert.equal(await page.locator('#body-a > [data-pr-owned]').count(),1);
  });
  await check('Dark mode maintains readable translation contrast', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(evidenceDir, 'reader-dark.png'), fullPage: true });
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
    const ratios=await page.locator('[data-pr-owned="translation"]').evaluateAll(nodes=>{
      const rgb=value=>value.match(/[\d.]+/g)?.slice(0,3).map(Number);
      const lum=color=>{const n=color.map(c=>{const v=c/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return n[0]*.2126+n[1]*.7152+n[2]*.0722;};
      return nodes.map(node=>{let background=[255,255,255];for(let parent=node;parent;parent=parent.parentElement){const value=getComputedStyle(parent).backgroundColor;if(value!=='rgba(0, 0, 0, 0)'&&value!=='transparent'){background=rgb(value);break;}}const a=lum(rgb(getComputedStyle(node).color)),b=lum(background);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
    });
    assert.ok(ratios.length>0&&Math.min(...ratios)>=4.5,JSON.stringify(ratios));
  });
  await check('Narrow desktop does not create horizontal overflow', async () => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
  });
  await check('Select a real word and look up its real local translation', async () => {
    await page.locator('#inline').scrollIntoViewIfNeeded();
    await page.evaluate(()=>{ const text=document.querySelector('#inline').firstChild;const range=document.createRange();range.setStart(text,9);range.setEnd(text,15);getSelection().removeAllRanges();getSelection().addRange(range);document.body.dispatchEvent(new Event('pointerup',{bubbles:true})); });
    await page.locator('[data-pr-owned="lookup"] button').click();
    await page.waitForFunction(()=>/\p{Script=Han}/u.test(document.querySelector('[data-pr-owned="lookup"]')?.shadowRoot?.querySelector('.result')?.textContent??''),{},{timeout:20000});
    assert.equal(await page.locator('[data-pr-owned="lookup"] .source').textContent(),'useful');
    await page.screenshot({ path:path.join(evidenceDir,'selection.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-pr-owned="lookup"]').count(),0);
  });
  const timeline=await context.newPage();
  await timeline.goto('http://127.0.0.1:9329/feed.html');
  await check('Generic blocks keep main and quoted posts separate (feed fixture)',async()=>{
    await timeline.waitForSelector('#post-text > [data-pr-owned]',{timeout:30000});
    await timeline.waitForSelector('#quote-text > [data-pr-owned]',{timeout:30000});
    assert.equal(await timeline.locator('header [data-pr-owned],button [data-pr-owned],[contenteditable] [data-pr-owned]').count(),0);
    assert.notEqual(await timeline.locator('#post-text > [data-pr-owned]').textContent(),await timeline.locator('#quote-text > [data-pr-owned]').textContent());
  });
  await check('200 recycled post updates keep only the final text translation',async()=>{
    await timeline.evaluate(()=>{for(let n=1;n<=200;n++){document.querySelector('#post-text').textContent=`Update ${n}: A different article explains how people can learn from one another and build useful tools for their communities.`;document.querySelector('#post a').href=`/notes/${n}`;}});
    await timeline.waitForFunction(()=>document.querySelector('#post-text > [data-pr-owned]')?.textContent.includes('200'),{},{timeout:30000});
    assert.equal(await timeline.locator('#post-text > [data-pr-owned]').count(),1);
    assert.equal(await timeline.locator('#quote-text > [data-pr-owned]').count(),1);
  });
  await check('New wrapper tags and unrelated attributes do not break extraction',async()=>{
    await timeline.evaluate(()=>{
      const old=document.querySelector('#post-text');const block=document.createElement('reading-content');
      block.id='post-text';block.style.display='block';block.className='completely-new-layout';block.setAttribute('data-random-framework-marker','new-version');block.textContent=old.firstChild.textContent;old.replaceWith(block);
    });
    await timeline.waitForFunction(()=>document.querySelector('#post-text > [data-pr-owned]')?.textContent.includes('200'),{},{timeout:30000});
    assert.equal(await timeline.locator('#post-text > [data-pr-owned]').count(),1);
  });
  await check('Whole-card links preserve their original accessible name', async () => {
    const text = 'A thoughtful reading experience helps people explore useful ideas and learn from the world around them.';
    await timeline.evaluate(text => {
      const link = document.createElement('a'); link.id = 'whole-card'; link.href = '/notes/another';
      const paragraph = document.createElement('p'); paragraph.id = 'whole-card-text'; paragraph.textContent = text;
      link.append(paragraph); document.querySelector('main').append(link);
    }, text);
    await timeline.bringToFront(); await timeline.locator('#whole-card').scrollIntoViewIfNeeded();
    await timeline.waitForSelector('#whole-card-text > [data-pr-owned]', { timeout: 30000 });
    assert.equal(await timeline.getByRole('link', { name: text, exact: true }).count(), 1);
  });
  await page.bringToFront();
  await check('Restore current page removes translations and pauses new content', async () => {
    const tabs = await options.evaluate(()=>chrome.tabs.query({}));
    const target = tabs.find(tab=>tab.url==='http://127.0.0.1:9329/');
    await options.evaluate(id=>chrome.tabs.sendMessage(id,{type:'PR_RESTORE'}),target.id);
    assert.equal(await page.locator('[data-pr-owned="translation"]').count(),0);
    await page.locator('#append').click(); await page.waitForTimeout(600);
    assert.equal(await page.locator('[data-pr-owned="translation"]').count(),0);
  });
  await check('Global off clears every reachable document', async () => {
    assert.ok(await timeline.locator('[data-pr-owned="translation"]').count()>0);
    await options.locator('#auto').uncheck();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('[data-pr-owned="translation"]').count(),0);
    assert.equal(await timeline.locator('[data-pr-owned="translation"]').count(),0);
  });
  await check('Manual translation works with global automatic translation off',async()=>{
    const tabs=await options.evaluate(()=>chrome.tabs.query({}));const target=tabs.filter(t=>t.url==='http://127.0.0.1:9329/').at(-1);
    await options.evaluate(id=>chrome.tabs.sendMessage(id,{type:'PR_TRANSLATE'}),target.id);
    await page.evaluate(()=>scrollTo(0,0));
    await page.waitForSelector('#hero > [data-pr-owned]',{timeout:30000});
    assert.equal(await options.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.autoTranslate),false);
  });
  await check('Service worker termination preserves settings and automatic operation',async()=>{
    await options.locator('#auto').check();
    await options.waitForFunction(async()=>(await chrome.storage.local.get('settings')).settings.autoTranslate);
    const workerSession=await context.newCDPSession(options);await workerSession.send('ServiceWorker.enable');await workerSession.send('ServiceWorker.stopAllWorkers');
    await options.locator('#font-size').selectOption('14');
    const second=await context.newPage();await second.goto('http://127.0.0.1:9329/');
    await second.waitForSelector('#hero > [data-pr-owned]',{timeout:30000});
    assert.equal(await options.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.minimumTranslationFontPx),14);
  });
  const popup = await actionPopup(page, id);
  await check('Actual extension action popup addresses the active page', async () => {
    assert.equal(await popup.evaluate('document.querySelector("#site").textContent'), '127.0.0.1');
    assert.equal(await popup.evaluate('document.querySelector("#auto").getAttribute("aria-checked")'), 'true');
  });
  await check('Actual popup restore removes current-page translations', async () => {
    await popup.evaluate('document.querySelector("#restore").click()');
    await page.waitForFunction(() => document.querySelectorAll('[data-pr-owned="translation"]').length === 0);
  });
  await check('Actual popup translates the current page', async () => {
    await popup.evaluate('document.querySelector("#translate").click()');
    await page.waitForSelector('#hero > [data-pr-owned]', { timeout: 30000 });
  });
  await check('Actual popup switch stops and persists automatic translation', async () => {
    await popup.evaluate('document.querySelector("#auto").click()');
    await page.waitForFunction(() => document.querySelectorAll('[data-pr-owned="translation"]').length === 0);
    await options.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.autoTranslate === false);
  });
  await check('Actual popup switch resumes automatic translation', async () => {
    await popup.evaluate('document.querySelector("#auto").click()');
    await page.waitForSelector('#hero > [data-pr-owned]', { timeout: 30000 });
    await options.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.autoTranslate === true);
  });
  const screenshot = await popup.command('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidenceDir, 'popup.png'), Buffer.from(screenshot.data, 'base64'));
  await popup.close();
  assert.deepEqual(errors,[]);
  await writeFile(path.join(evidenceDir,'network.json'), JSON.stringify([...networks],null,2));
  console.log(`${results.length} browser checks passed. Evidence: .private/browser-evidence/`);
} catch (error) {
  await writeFile(path.join(evidenceDir, 'failure.txt'), String(error.stack ?? error));
  throw error;
} finally {
  server.close(); await browser.close();
}
