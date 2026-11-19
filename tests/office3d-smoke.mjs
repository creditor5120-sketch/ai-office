import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));

try {
  await page.goto('http://127.0.0.1:4173/office3d.html', { waitUntil: 'commit', timeout: 15000 });
  try {
    await page.locator('#loading').waitFor({ state: 'hidden', timeout: 45000 });
  } catch {
    const loadingText = await page.locator('#loading').innerText().catch(() => 'loading element unavailable');
    throw new Error('3D initialization did not finish. Loading panel: ' + loadingText + '\\nBrowser errors: ' + pageErrors.join('\\n'));
  }
  await page.locator('#scene canvas').waitFor({ state: 'attached', timeout: 10000 });

  const staffCount = await page.locator('#staffStrip .staffCard').count();
  if (staffCount < 30) throw new Error(`Expected at least 30 staff cards, found ${staffCount}`);
  const visibleCount = Number((await page.locator('#activeCount').innerText()).trim());
  if (visibleCount < 30) throw new Error(`Expected at least 30 rendered staff, found ${visibleCount}`);

  await page.locator('#staffStrip .staffCard').first().click();
  const selectedName = (await page.locator('#chatName').innerText()).trim();
  if (!selectedName) throw new Error('Selecting a staff card did not update the chat header');

  await page.locator('#detailToggle').click();
  await page.locator('#detailView').waitFor({ state: 'visible' });
  const detailCount = await page.locator('#detailEmployeeList .detailPerson').count();
  if (detailCount < 30) throw new Error(`Expected at least 30 employees in detail view, found ${detailCount}`);

  await page.locator('#detailToggle').click();
  await page.locator('#appMain').waitFor({ state: 'visible' });
  const backLink = await page.locator('header a.action').getAttribute('href');
  if (backLink !== './index.html') throw new Error(`Unexpected 2D navigation target: ${backLink}`);

  if (pageErrors.length) throw new Error('Browser page errors: ' + pageErrors.join(' | '));
  console.log(JSON.stringify({
    result: 'PASS',
    canvas: true,
    staffCards: staffCount,
    visibleStaff: visibleCount,
    selectedStaff: selectedName,
    detailViewStaff: detailCount,
    navigationTo2D: backLink,
    pageErrors
  }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
