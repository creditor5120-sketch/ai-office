import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
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
await new Promise(resolve => server.listen(4174, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));

const reportText = 'v11 대표 수신함 브라우저 검증 보고 본문';
const fixture = {
  ceo1: [{
    role: 'assistant',
    content: reportText,
    show: reportText,
    t: '2026-11-24 15:00',
    act: {
      taskId: 'smoke-v11-ceo-report',
      releaseAllowed: true,
      blockers: [],
      gateNotes: []
    }
  }]
};

try {
  await page.addInitScript(history => {
    localStorage.setItem('swAIOfficeV11History', JSON.stringify(history));
  }, fixture);
  await page.goto('http://127.0.0.1:4174/office-v11-preview.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#strip [data-e="ceo1"]').waitFor({ state: 'visible', timeout: 45000 });
  await page.locator('#strip [data-e="ceo1"]').click();
  await page.locator('#ceoReportInboxList article').waitFor({ state: 'visible', timeout: 10000 });

  const inboxText = await page.locator('#ceoReportInboxList').innerText();
  if (!inboxText.includes(reportText)) {
    throw new Error('대표 보고 수신함에 저장된 보고 본문이 표시되지 않습니다: ' + inboxText);
  }
  if (!inboxText.includes('smoke-v11-ceo-report')) {
    throw new Error('대표 보고 수신함에 업무번호가 표시되지 않습니다: ' + inboxText);
  }
  if (!inboxText.includes('최종 검수 완료 · 대표 승인 대기')) {
    throw new Error('대표 보고 수신함에 승인 대기 상태가 표시되지 않습니다: ' + inboxText);
  }
  await page.locator('#ceoReportInboxList button').filter({ hasText: '대표 승인' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#ceoReportInboxList button').filter({ hasText: '반려' }).waitFor({ state: 'visible', timeout: 5000 });
  await mkdir('artifacts', { recursive: true });
  await page.locator('#ceoReportInbox').screenshot({ path: 'artifacts/sw-ai-office-v11-ceo-inbox.png' });

  console.log(JSON.stringify({
    result: 'PASS',
    reportCards: await page.locator('#ceoReportInboxList article').count(),
    approvalButton: true,
    rejectionButton: true,
    pageErrors
  }, null, 2));
} catch (error) {
  const diagnostic = await page.evaluate(() => ({
    ceoCards: document.querySelectorAll('#strip [data-e="ceo1"]').length,
    inboxVisible: !!document.querySelector('#ceoReportInboxList article'),
    ceoNotice: document.querySelector('#ceoNoticeBox')?.outerHTML?.slice(0, 2000) || null
  })).catch(() => ({}));
  throw new Error((error.stack || String(error)) + '\\nDiagnostic: ' + JSON.stringify({ diagnostic, pageErrors }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
