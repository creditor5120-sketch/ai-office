import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? '/office-v315-integrated.html' : pathname;
    const target = path.resolve(root, '.' + relative);
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid path');
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

let browser;
try {
  await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:4173/office-v315-integrated.html', { waitUntil: 'domcontentloaded' });
  const officeFrame = page.frameLocator('#office');
  await officeFrame.locator('#swWorkflowEngineButton').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await officeFrame.locator('header').count(), 1, 'original office header should render');
  assert.equal(await officeFrame.locator('#stage').count(), 1, 'original office stage should render');
  assert.equal(await officeFrame.locator('#chat').count(), 1, 'original office chat should render');

  const toggle = officeFrame.locator('#swWorkflowEngineButton');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.match(await toggle.getAttribute('aria-label'), /닫기/);
  assert.equal(await page.locator('#bridgePanel').evaluate(el => el.classList.contains('open')), true);

  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/sw-ai-office-v315-integrated.png', fullPage: true });

  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.match(await toggle.getAttribute('aria-label'), /열기/);
  assert.equal(await page.locator('#bridgePanel').evaluate(el => el.classList.contains('open')), false);
  assert.deepEqual(pageErrors, [], 'page should not emit uncaught JavaScript errors');
  process.stdout.write('PASS: original office rendered; workflow panel opens/closes; accessibility state updates; screenshot saved.\\n');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
