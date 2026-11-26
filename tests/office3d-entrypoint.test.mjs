import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

test('GitHub Pages root opens the integrated 3D office', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /http-equiv=["']refresh["'][^>]*url=\.\/office3d\.html/i);
  assert.match(index, /window\.location\.replace\(["']\.\/office3d\.html["']\)/);
  await access(new URL('../office3d.html', import.meta.url));
  const map = await readFile(new URL('../office-map.html', import.meta.url), 'utf8');
  assert.match(map, /직원 추가/);
  assert.doesNotMatch(map, /KARYAWAN/);
  const office = await readFile(new URL('../office3d.html', import.meta.url), 'utf8');
  assert.match(office, /collaboration=\/협업\|회의\/.test\(stage\)/);
  assert.match(office, /status:collaboration\?'협업 중':meeting\?'검수 중':'업무 중'/);
  assert.match(office, /if\(\[408,425,429,500,502,503,504\]\.includes\(response\.status\)\)/);
  assert.match(office, /동일 업무 ID로 재시도합니다/);
  assert.match(office, /idempotencyKey:taskId/);
  assert.match(office, /const PENDING_TASK_KEY='swAIOfficePendingTask'/);
  assert.match(office, /deskCount:officeDeskSlots\.length/);
  assert.match(office, /savePendingTask\(\{task,taskId,employeeId:p\.id,employeeName,status:'PROCESSING'/);
  assert.match(office, /const taskId=resumeRecord\?\.taskId\|\|crypto\.randomUUID\(\)/);
  assert.match(office, /savedAt:resumeRecord\?\.savedAt\|\|new Date\(\)\.toISOString\(\)/);
  assert.match(office, /submitSelectedTask\(record\.task,record\)/);
  assert.match(office, /clearPendingTask\(taskId\)/);
    assert.match(office, /u\.workStatus==='협업 중'/);
  assert.match(office, /const isRepresentative=selected\?\.userData\.person\.id==='CEO'/);
  assert.match(office, /location\.protocol==='file:'/);
  assert.match(office, /GitHub Pages에 배포된 SW AI OFFICE 주소/);
  assert.match(office, /대표이사 전사 업무 보고함/);
  assert.match(office, /function evaluateRepresentativeRelease\(record\)/);
  assert.match(office, /const incomplete=deliverables\.filter\(item=>item\?\.status!=='completed'\)/);
  assert.match(office, /최종 검수가 누락된 결과물/);
  assert.match(office, /최종 검수 승인 상태가 아닌 결과물/);
  assert.match(office, /대표 승인 보류:/);
  assert.match(office, /아직 등록된 전사 업무 보고가 없습니다/);
});

test('representative approval gate blocks incomplete or unreviewed work', async () => {
  const office = await readFile(new URL('../office3d.html', import.meta.url), 'utf8');
  const start = office.indexOf('function evaluateRepresentativeRelease(record){');
  const end = office.indexOf('\nfunction renderRepresentativeDecision', start);
  assert.ok(start >= 0 && end > start, 'approval gate function must be present and extractable');
  const evaluate = new Script(office.slice(start, end) + '\nevaluateRepresentativeRelease').runInNewContext();

  const approvedRecord = {
    taskId: 'approval-gate-test',
    deliverables: [{ id: 'specialist-1', title: '업무 결과물', status: 'completed' }],
    finalReviewResults: [{ id: 'specialist-1', judgment: '승인' }],
    workflow: { reviewGate: { finalReleaseAllowed: true } }
  };
  const allowed = evaluate(approvedRecord);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.blockers.length, 0);

  const blockedCases = [
    ['서버 검수 게이트 미승인', { ...approvedRecord, workflow: { reviewGate: { finalReleaseAllowed: false } } }, '서버 최종 검수 게이트'],
    ['결과물 없음', { ...approvedRecord, deliverables: [] }, '결과물이 등록되지 않았습니다'],
    ['결과물 미완료', { ...approvedRecord, deliverables: [{ id: 'specialist-1', title: '업무 결과물', status: 'partial' }] }, '완료되지 않은 결과물'],
    ['최종 검수 누락', { ...approvedRecord, finalReviewResults: [] }, '최종 검수가 누락된 결과물'],
    ['최종 검수 조건부 승인', { ...approvedRecord, finalReviewResults: [{ id: 'specialist-1', judgment: '조건부 승인' }] }, '최종 검수 승인 상태가 아닌 결과물']
  ];

  for (const [label, record, expectedBlocker] of blockedCases) {
    const result = evaluate(record);
    assert.equal(result.allowed, false, label + ' 상태에서는 대표 승인이 차단되어야 합니다.');
    assert.ok(result.blockers.some(item => item.includes(expectedBlocker)), label + ' 차단 사유가 표시되어야 합니다.');
  }
});
