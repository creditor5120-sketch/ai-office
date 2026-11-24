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

  // 새 브라우저 저장소를 가정해 Worker의 서버 기록만으로 보고함을 복원하는지 검증한다.
  const serverReportText = '다른 기기에서 복원된 서버 저장 보고 본문';
  let representativeHeaderSeen = false;
  await page.route('https://ai-office-api.creditor5120.workers.dev/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': 'http://127.0.0.1:4174',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Representative-Authorization'
        }
      });
      return;
    }
    const payload = request.postDataJSON();
    if (request.headers()['x-representative-authorization'] !== 'Bearer smoke-representative-token') {
      throw new Error('서버 조회 요청에 대표 전용 인증 헤더가 없습니다: ' + payload.action);
    }
    representativeHeaderSeen = true;
    if (payload.action === 'get_recent_tasks') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        count: 1,
        tasks: [{ taskId: 'server-only-task', status: 'COMPLETED', createdAt: '2026-11-24T06:00:00.000Z', updatedAt: '2026-11-24T06:10:00.000Z', completedAt: '2026-11-24T06:10:00.000Z' }]
      }) });
      return;
    }
    if (payload.action === 'get_task_history') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        task: { taskId: 'server-only-task', status: 'COMPLETED', completedAt: '2026-11-24T06:10:00.000Z' },
        result: {
          taskId: 'server-only-task',
          reply: serverReportText,
          deliverables: [{ id: 'specialist', status: 'completed', name: '전문 직원' }],
          finalReviewResults: [{ id: 'specialist', judgment: '승인' }],
          workflow: { reviewGate: { finalReleaseAllowed: true } }
        },
        events: []
      }) });
      return;
    }
    if (payload.action === 'get_representative_decision') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ taskId: payload.taskId, decision: null }) });
      return;
    }
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected action' }) });
  });
  await page.addInitScript(() => {
    localStorage.removeItem('swAIOfficeV11History');
    localStorage.setItem('sw_srv_cfg', JSON.stringify({
      on: true,
      url: 'https://ai-office-api.creditor5120.workers.dev/',
      token: 'smoke-general-token',
      rep: 'smoke-representative-token'
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#strip [data-e="ceo1"]').click();
  await page.locator('#ceoReportInboxList').getByText(serverReportText).waitFor({ state: 'visible', timeout: 12000 });
  const serverInboxText = await page.locator('#ceoReportInboxList').innerText();
  if (!serverInboxText.includes('server-only-task')) {
    throw new Error('서버에서 복원된 보고에 업무번호가 없습니다: ' + serverInboxText);
  }
  if (!representativeHeaderSeen) {
    throw new Error('서버 보고 복원 요청에서 대표 전용 인증 헤더가 확인되지 않았습니다.');
  }

  console.log(JSON.stringify({
    result: 'PASS',
    localReportCards: await page.locator('#ceoReportInboxList article').count(),
    serverReportRestored: serverInboxText.includes(serverReportText),
    representativeReadAuth: representativeHeaderSeen,
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
