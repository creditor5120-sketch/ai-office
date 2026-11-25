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
await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
const browserConsole = [];
const failedRequests = [];
page.on('pageerror', error => pageErrors.push(error.stack || error.message));
page.on('console', message => { if (message.type() === 'error') browserConsole.push(message.text()); });
page.on('requestfailed', request => failedRequests.push({url: request.url(), error: request.failure()?.errorText || 'unknown'}));

try {
  await page.goto('http://127.0.0.1:4173/office3d.html', { waitUntil: 'commit', timeout: 15000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('#loading');
    return !panel || getComputedStyle(panel).display === 'none' || panel.textContent.includes('초기화 오류');
  }, { timeout: 15000 }).catch(async error => {
    const diagnostic = await page.evaluate(() => ({
      loading: document.querySelector('#loading')?.innerText || '(missing)',
      moduleScripts: [...document.scripts].map(s => ({type:s.type,src:s.src})),
      canvas: !!document.querySelector('#scene canvas'),
      html: document.querySelector('#loading')?.outerHTML || ''
    }));
    throw new Error('3D startup timeout: ' + JSON.stringify({diagnostic,pageErrors,browserConsole,failedRequests}, null, 2) + '\\n' + error.message);
  });
  const loadingText = await page.locator('#loading').innerText().catch(() => '');
  if (loadingText.includes('초기화 오류')) {
    throw new Error('3D initialization failed. Loading panel: ' + loadingText + '\\nBrowser errors: ' + pageErrors.join('\\n'));
  }
  await page.locator('#scene canvas').waitFor({ state: 'attached', timeout: 10000 });
  await mkdir('artifacts', { recursive: true });
  await page.locator('#officeStage').screenshot({ path: 'artifacts/sw-ai-office-3d-stage.png' });

  const officeAudit = await page.evaluate(() => window.__officeFloorAudit?.());
  if (!officeAudit || officeAudit.floorCount !== 1 || officeAudit.activeFloor !== 1 || officeAudit.visibleOffice !== true || officeAudit.teamCount !== 6 || officeAudit.deskCount !== 31) {
    throw new Error('단층 사무실 상태 감사 정보가 올바르지 않습니다: ' + JSON.stringify(officeAudit));
  }
  if (officeAudit.avatarCount < 30) throw new Error('단층 사무실 직원 캐릭터가 충분하지 않습니다');
  await page.waitForTimeout(500);
  await page.locator('#officeStage').screenshot({ path: 'artifacts/sw-ai-office-3d-single-floor.png' });
  const staffCount = await page.locator('#staffStrip .staffCard').count();
  if (staffCount < 31) throw new Error(`Expected at least 31 staff cards, found ${staffCount}`);
  const visibleCount = Number((await page.locator('#activeCount').innerText()).trim());
  if (visibleCount < 31) throw new Error(`Expected at least 31 rendered staff, found ${visibleCount}`);

  await page.locator('#staffStrip .staffCard[data-emp="CEO"]').first().click();
  const selectedName = (await page.locator('#chatName').innerText()).trim();
  if (selectedName !== '단테') throw new Error(`대표이사 첫 직원 카드 이름 오류: expected 단테, found ${selectedName || '(empty)'}`);
  // 직원 카드를 누르면 프로필 모달이 열리므로 다음 직원 선택 전에 닫는다.
  await page.locator('#modal #close').click();
  await page.locator('#modal').waitFor({ state: 'hidden', timeout: 5000 });
  const legalLeadCard = page.locator('#staffStrip .staffCard[data-emp="LE-01"]').first();
  await legalLeadCard.waitFor({ state: 'visible', timeout: 10000 });
  await legalLeadCard.click();
  const legalLeadName = (await page.locator('#chatName').innerText()).trim();
  if (legalLeadName !== '피터') throw new Error(`법무팀장 이름 오류: expected 피터, found ${legalLeadName || '(empty)'}`);
  // 대표 단테의 전사 업무 지시는 알렉스에게, 직원 선택 지시는 해당 직원에게 전달되어야 한다.
  await page.locator('#modal #close').click();
  await page.locator('#modal').waitFor({ state: 'hidden', timeout: 5000 });
  await page.locator('#officeChatToken').fill('smoke-test-api-token');
  const routedPayloads = [];
  await page.route('https://ai-office-api.creditor5120.workers.dev/', async route => {
    const body = route.request().postDataJSON();
    if (!body.action) {
      routedPayloads.push(body);
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'smoke route capture' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    }
  });
  await page.locator('#staffStrip .staffCard[data-emp="CEO"]').first().click();
  await page.locator('#close').click();
  await page.locator('#taskInput').fill('대표 업무 라우팅 회귀 테스트');
  await page.locator('#sendTask').click();
  await page.waitForFunction(() => document.querySelectorAll('#chatHistory .chatBubble').length >= 2, { timeout: 5000 });
  await page.waitForTimeout(500);
  if (routedPayloads.length !== 1 || routedPayloads[0].employeeId !== 'COO' || routedPayloads[0].employee !== '알렉스') {
    throw new Error('대표 단테의 업무 지시가 본부장 알렉스에게 전달되지 않았습니다: ' + JSON.stringify({routedPayloads,chatHistory:await page.locator('#chatHistory').innerText(),selectedName:await page.locator('#chatName').innerText(),taskInput:await page.locator('#taskInput').inputValue(),pageErrors,browserConsole,failedRequests}));
  }
  // Regression test: Ensure routing contract is strictly enforced
  if (routedPayloads[0].employeeId !== 'COO' || routedPayloads[0].employee !== '알렉스') {
    throw new Error('Routing contract violation: CEO selection must route to COO 알렉스');
  }
  const routedDirectory = routedPayloads[0].employees || [];
  // Regression test: Ensure routing contract is strictly enforced
  if (routedPayloads[0].employeeId !== 'COO' || routedPayloads[0].employee !== '알렉스') {
    throw new Error('Routing contract violation: CEO selection must route to COO 알렉스');
  }
  const expectedNames = { COO: '알렉스', 'MA-01': '데니스', 'LE-01': '피터', 'IR-01': '라이언', 'GA-01': '에이든', 'SP-01': '에릭', 'IT-01': '테오' };
  for (const [employeeId, expectedName] of Object.entries(expectedNames)) {
    const employee = routedDirectory.find(person => person.id === employeeId);
    if (!employee || employee.name !== expectedName) {
      throw new Error('AI 업무 배정 명단의 직원 이름이 화면과 일치하지 않습니다: ' + employeeId + ' expected ' + expectedName + ', found ' + (employee?.name || '(missing)'));
    }
  }
  const alexCardName = (await page.locator('#staffStrip .staffCard[data-emp="COO"] .staffMeta b').innerText()).trim();
  if (alexCardName !== '알렉스') throw new Error('본부장 카드 이름 오류: expected 알렉스, found ' + alexCardName);
  // Regression test: Ensure routing contract is strictly enforced
  if (routedPayloads[0].employeeId !== 'COO' || routedPayloads[0].employee !== '알렉스') {
    throw new Error('Routing contract violation: CEO selection must route to COO 알렉스');
  }
  await page.locator('#staffStrip .staffCard[data-emp="LE-01"]').first().click();
  await page.locator('#modal #close').click();
  await page.locator('#taskInput').fill('직원 직접 업무 라우팅 회귀 테스트');
  await page.locator('#sendTask').click();
  await page.waitForTimeout(200);
  if (routedPayloads.length !== 2 || routedPayloads[1].employeeId !== 'LE-01' || routedPayloads[1].employee !== '피터') {
    throw new Error('직원 직접 지시 경로가 유지되지 않았습니다: ' + JSON.stringify(routedPayloads));
  }

  // 브라우저를 다시 열어도 기존 업무 ID로 이어서 제출되는지 확인한다.
  const interruptedFixture = {
    taskId: 'smoke-resume-existing-task',
    task: '중단 업무 이어하기 브라우저 회귀 테스트',
    employeeId: 'COO',
    employeeName: '알렉스',
    status: 'INTERRUPTED',
    savedAt: new Date().toISOString()
  };
  await page.evaluate(record => localStorage.setItem('swAIOfficePendingTask', JSON.stringify(record)), interruptedFixture);
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const panel = document.querySelector('#loading');
    return !panel || getComputedStyle(panel).display === 'none' || panel.textContent.includes('초기화 오류');
  }, { timeout: 45000 });
  await page.locator('#officeChatToken').fill('smoke-test-api-token');
  await page.locator('#pendingTaskRecovery').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#resumePendingTask').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#chatHistory .chatBubble')].some(el => el.textContent.includes('처리 오류: smoke route capture')), { timeout: 10000 });
  const resumedPayload = routedPayloads[2];
  if (!resumedPayload || resumedPayload.taskId !== interruptedFixture.taskId || resumedPayload.idempotencyKey !== interruptedFixture.taskId || resumedPayload.employeeId !== 'COO') {
    throw new Error('중단 업무 이어하기가 기존 업무 ID·멱등성 키를 재사용하지 않았습니다: ' + JSON.stringify(resumedPayload));
  }
  // Verify that the bridge does not generate a new taskId when resuming
  if (resumedPayload.taskId !== 'smoke-resume-existing-task') {
    throw new Error('중단 업무 이어하기가 기존 업무 ID를 유지하지 않았습니다.');
  }
  await page.evaluate(() => localStorage.removeItem('swAIOfficePendingTask'));

  const restoreFixture = {
    taskId: 'smoke-history-restore',
    task: '복원 테스트 업무 지시',
    reply: '복원 테스트 최종 보고',
    employeeId: 'COO',
    employeeIds: ['COO', 'MA-01'],
    employeeName: '알렉스',
    department: '본부장실',
    savedAt: new Date().toISOString(),
    deliverables: [{ id: 'MA-01', title: '복원 테스트 결과물', department: '경영관리', teamLeader: '데니스', status: '완료', content: '복원된 결과물 본문 확인 문자열' }],
    workflow: { currentStage: '최종 검수 완료', status: 'COMPLETED', resultStatus: '승인', reviewGate: { finalReleaseAllowed: true } },
    finalReviewResults: [{ id: 'MA-01', name: '데니스', judgment: '승인', review: '검수 내용 복원 확인' }],
    representativeDecision: { decision: 'APPROVE', decisionLabel: '대표 승인', recordedAt: '2026-11-19T10:00:00Z' },
    audit: { task: { taskId: 'smoke-history-restore', status: 'COMPLETED', currentStage: '최종 검수 완료' }, events: [{ eventType: 'REPRESENTATIVE_DECISION', stage: '대표 승인', detail: { decision: 'APPROVE', decisionLabel: '대표 승인' }, createdAt: '2026-11-19T10:00:00Z' }] }
  };
  await page.evaluate(record => {
    localStorage.setItem('swAIOffice3DTaskHistory', JSON.stringify([record]));
  }, restoreFixture);
  await page.route('https://ai-office-api.creditor5120.workers.dev/', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'get_task_history') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        task: { taskId: body.taskId, status: 'COMPLETED', currentStage: '서버 최종 검수', createdAt: '2026-11-19T09:00:00Z', completedAt: '2026-11-19T09:05:00Z' },
        eventCount: 2, truncated: false,
        events: [
          { eventType: 'WORKFLOW_STAGE_STARTED', stage: '서버 최종 검수', actor: '알렉스', detail: { outcome: '서버 원본 이력 확인' }, createdAt: '2026-11-19T09:04:00Z' },
          { eventType: 'REPRESENTATIVE_DECISION', stage: '대표 승인', actor: '대표', detail: { decision: 'APPROVE', decisionLabel: '서버 대표 승인', reason: '서버 기록 복원' }, createdAt: '2026-11-19T09:05:00Z' }
        ]
      }) });
    } else if (body.action === 'get_representative_decision') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ taskId: body.taskId, decision: 'APPROVE', decisionLabel: '서버 대표 승인', reason: '서버 기록 복원', recordedAt: '2026-11-19T09:05:00Z' }) });
    } else {
      await route.continue();
    }
  });
  await page.locator('#officeChatToken').fill('smoke-test-api-token');
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const panel = document.querySelector('#loading');
    return !panel || getComputedStyle(panel).display === 'none' || panel.textContent.includes('초기화 오류');
  }, { timeout: 45000 });
  await page.locator('#officeChatToken').fill('smoke-test-api-token');
  const managerCard = page.locator('#staffStrip .staffCard[data-emp="COO"]');
  await managerCard.waitFor({ state: 'visible', timeout: 10000 });
  await managerCard.click();
  await page.locator('#chatName').getByText('알렉스').waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
    const actual = (await page.locator('#chatName').innerText()).trim();
    throw new Error(`Selecting COO did not update the active employee. Expected 알렉스, found ${actual || '(empty)'}`);
  });
  await page.locator('#close').click();
  await page.locator('#detailToggle').click();
  await page.locator('#detailView').waitFor({ state: 'visible' });
  const restoredItem = page.locator('#taskHistoryList .historyItem').filter({ hasText: '복원 테스트 업무 지시' });
  await restoredItem.waitFor({ state: 'visible', timeout: 10000 });
  await restoredItem.click();
  const restoredChat = await page.locator('#detailMessages').innerText();
  if (!restoredChat.includes('복원된 결과물 본문 확인 문자열')) throw new Error('Saved deliverable content was not restored into the conversation');
  if (!restoredChat.includes('검수 내용 복원 확인')) throw new Error('Saved final review details were not restored into the conversation');
  if (!(await page.locator('#representativeApprove').isDisabled())) throw new Error('Previously recorded representative decision did not lock approval');
  const decisionHint = await page.locator('#decisionTaskHint').innerText();
  if (!decisionHint.includes('대표 승인')) throw new Error('Representative decision was not restored in the decision panel');
  const representativeCard = page.locator('#detailEmployeeList .detailPerson[data-emp="CEO"]');
  await representativeCard.waitFor({ state: 'visible', timeout: 10000 });
  await representativeCard.click();
  const representativeHistoryItem = page.locator('#taskHistoryList .historyItem').filter({ hasText: '복원 테스트 업무 지시' });
  await representativeHistoryItem.waitFor({ state: 'visible', timeout: 5000 });
  const representativeInboxHeading = await page.locator('#taskHistoryPanel h3').innerText();
  if (!representativeInboxHeading.includes('대표이사 전사 업무 보고함')) throw new Error('대표이사 전사 업무 보고함 제목이 표시되지 않습니다');
  const representativeHistoryCount = await page.locator('#taskHistoryList .historyItem').count();
  if (representativeHistoryCount < 1) throw new Error('대표이사 화면에서 전사 업무 이력을 조회할 수 없습니다');
  // 직원 선택은 프로필 모달을 열기 때문에 다음 직원 클릭 전에 모달을 닫아야 한다.
  if (await page.locator('#modal').isVisible()) await page.locator('#close').click();
  await page.locator('#modal').waitFor({ state: 'hidden', timeout: 5000 });
  await page.locator('#detailEmployeeList .detailPerson[data-emp="COO"]').click();
  await page.locator('#taskHistoryList .historyItem').filter({ hasText: '복원 테스트 업무 지시' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#detailMessages').getByText('서버 원본 감사 이력').waitFor({ state: 'visible', timeout: 10000 });
  const refreshedChat = await page.locator('#detailMessages').innerText();
  if (!refreshedChat.includes('서버 원본 이력 확인')) throw new Error('Server audit history was not reloaded');
  if (!refreshedChat.includes('서버 대표 승인')) throw new Error('Server representative decision was not reloaded');

  const detailCount = await page.locator('#detailEmployeeList .detailPerson').count();
  if (detailCount < 31) throw new Error(`Expected at least 31 employees in detail view, found ${detailCount}`);
  // COO 선택도 프로필 모달을 열므로 사무실 화면으로 돌아가기 전에 닫는다.
  if (await page.locator('#modal').isVisible()) await page.locator('#close').click();
  await page.locator('#modal').waitFor({ state: 'hidden', timeout: 5000 });

  await page.locator('#detailToggle').click();
  await page.locator('#appMain').waitFor({ state: 'visible' });
  const backLink = await page.locator('header a.action').getAttribute('href');
  if (backLink !== './office-map.html') throw new Error(`Unexpected 2D navigation target: ${backLink}`);

  await page.locator('header a.action').click();
  await page.waitForURL('**/office-map.html', { timeout: 15000 });
  await page.locator('.office-name').waitFor({ state: 'visible', timeout: 10000 });
  const twoDName = (await page.locator('.office-name').innerText()).trim();
  if (twoDName !== 'SW AI OFFICE') throw new Error(`Unexpected 2D office title: ${twoDName}`);
  const forwardLink = page.locator('a[href="./office3d.html"]').first();
  if (await forwardLink.count() !== 1) throw new Error('2D page is missing the 3D office navigation link');
  await forwardLink.click();
  await page.waitForURL('**/office3d.html', { timeout: 15000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector('#loading');
    return !panel || getComputedStyle(panel).display === 'none' || panel.textContent.includes('초기화 오류');
  }, { timeout: 45000 });
  const reentryError = await page.locator('#loading').innerText().catch(() => '');
  if (reentryError.includes('초기화 오류')) throw new Error('3D re-entry failed: ' + reentryError);
  if (pageErrors.length) throw new Error('Browser page errors: ' + pageErrors.join(' | '));
  console.log(JSON.stringify({
    result: 'PASS',
    canvas: true,
    staffCards: staffCount,
    visibleStaff: visibleCount,
    selectedStaff: selectedName,
    legalTeamLead: legalLeadName,
    detailViewStaff: detailCount,
    navigationTo2D: backLink,
    twoDTitle: twoDName,
    navigationBackTo3D: './office3d.html',
    pageErrors
  }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
