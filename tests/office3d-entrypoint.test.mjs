import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

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
  assert.match(office, /savePendingTask\(\{task,taskId,employeeId:p\.id,employeeName,status:'PROCESSING'/);
  assert.match(office, /const taskId=resumeRecord\?\.taskId\|\|crypto\.randomUUID\(\)/);
  assert.match(office, /savedAt:resumeRecord\?\.savedAt\|\|new Date\(\)\.toISOString\(\)/);
  assert.match(office, /submitSelectedTask\(record\.task,record\)/);
  assert.match(office, /clearPendingTask\(taskId\)/);
    assert.match(office, /u\.workStatus==='협업 중'/);
  assert.match(office, /const isRepresentative=selected\?\.userData\.person\.id==='CEO'/);
});
