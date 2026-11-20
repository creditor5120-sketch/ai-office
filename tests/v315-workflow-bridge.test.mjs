import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../workflow-bridge-v315.js', import.meta.url), 'utf8');

function makeContext({ selectedId = 'alex', fail = false, workflowStatus = 'completed' } = {}) {
  const calls = [];
  let shouldFail = fail;
  const employees = [
    { id: 'alex', name: '알렉스', badge: '본부장', room: 'hq', duty: '전사 업무 분석 및 배정' },
    { id: 'ceo1', name: '단테', badge: '대표이사', room: 'ceo', duty: '최종 의사결정' },
    { id: 'denis', name: '데니스', badge: '경영관리팀장', room: 'shared', duty: '경영관리 검수' },
    { id: 'aiden', name: '에이든', badge: '총무팀장', room: 'shared', duty: '총무 검수' },
    { id: 'eric', name: '에릭', badge: '전략기획팀장', room: 'shared', duty: '전략기획 검수' },
    { id: 'peter', name: '피터', badge: '법무팀장', room: 'legal', duty: '법무 검수' },
    { id: 'ryan', name: '라이언', badge: 'IR팀장', room: 'ir', duty: 'IR 검수' },
    { id: 'teo', name: '테오', badge: 'IT·기술팀장', room: 'it', duty: '기술 검수' }
  ];
  const storage = new Map();
  const progressBubble = { textContent: '…' };
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  };
  const sandbox = {
    EMP: employees,
    st: { sel: selectedId },
    E: id => employees.find(person => person.id === id),
    crypto: { randomUUID: () => 'test-task-id' },
    CustomEvent: function CustomEvent(name) { this.type = name; },
    localStorage,
    document: { querySelector: () => progressBubble },
    callConfiguredLLM: async () => ({ text: '기존 개인 대화 응답' }),
    dispatchEvent: () => true,
    parent: {
      SWWorkflowBridge: {
        execute: async (payload, onProgress) => {
          calls.push(payload);
          if (typeof onProgress === 'function') onProgress({ currentStage: '전문 직원 수행' });
          if (shouldFail) throw new Error('인증값 누락');
          return {
            reply: '본부장 최종 보고',
            deliverables: [{ title: '법무 검토서', department: '법무팀', status: '완료', teamLeader: '피터', content: '검토 결과' }],
            workflow: { status: workflowStatus, reviewGate: { finalReleaseAllowed: workflowStatus === 'completed' } }
          };
        }
      }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'workflow-bridge-v315.js' });
  return { sandbox, calls, storage, progressBubble, setFail: value => { shouldFail = value; } };
}

test('Alex instruction is sent to the workflow engine with a COO record and team leaders', async () => {
  const { sandbox, calls, storage, progressBubble } = makeContext();
  const result = await sandbox.callConfiguredLLM([
    { role: 'user', content: '직원 시스템 프롬프트\n\n[사용자 요청]\n계약서 검토 및 수정안 작성' }
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task, '계약서 검토 및 수정안 작성');
  assert.equal(calls[0].taskId, 'test-task-id');
  assert.equal(calls[0].employeeId, 'alex');
  assert.equal(calls[0].employees.find(person => person.id === 'COO').name, '단테');
  for (const team of ['경영관리팀', '총무팀', '전략기획팀', '법무팀', 'IR팀', '기술·IT팀']) {
    assert.ok(calls[0].employees.some(person => person.department === team && person.position.includes('팀장')), team);
  }
  assert.match(result.text, /본부장 최종 보고/);
  assert.match(result.text, /법무 검토서/);
  assert.match(result.text, /대표 승인 전 외부 실행: 수행하지 않음/);
  assert.match(progressBubble.textContent, /전문 직원 수행/);
  const history = JSON.parse(storage.get('swV315WorkflowTaskHistory'));
  assert.equal(history[0].taskId, 'test-task-id');
});

test('a worker failure is shown as a failure and never falls back to a canned answer', async () => {
  const { sandbox, storage } = makeContext({ fail: true });
  const result = await sandbox.callConfiguredLLM([{ role: 'user', content: '업무 지시' }]);
  assert.match(result.text, /실제 업무처리 실패/);
  assert.match(result.text, /인증값 누락/);
  assert.doesNotMatch(result.text, /기존 개인 대화 응답/);
  const history = JSON.parse(storage.get('swV315WorkflowTaskHistory'));
  assert.equal(history[0].taskId, 'test-task-id');
  assert.match(history[0].error, /인증값 누락/);
});

test('other employees retain their original one-to-one conversation behavior', async () => {
  const { sandbox, calls } = makeContext({ selectedId: 'peter' });
  const result = await sandbox.callConfiguredLLM([{ role: 'user', content: '계약서 조항 설명' }]);
  assert.equal(result.text, '기존 개인 대화 응답');
  assert.equal(calls.length, 0);
});


test('integrated wrapper keeps accepted RECEIVED tasks in the polling flow', async () => {
  const wrapper = await readFile(new URL('../office-v315-integrated.html', import.meta.url), 'utf8');
  assert.match(wrapper, /response\.status===409&&data\.status==='RECEIVED'/);
  assert.match(wrapper, /업무 접수 완료 · 실행 대기 중/);
  assert.match(wrapper, /setTimeout\(resolve,1500\)/);
});

test('integrated wrapper retries transient network failures with the same idempotent payload', async () => {
  const wrapper = await readFile(new URL('../office-v315-integrated.html', import.meta.url), 'utf8');
  assert.match(wrapper, /let response;\s*try\s*\{[\s\S]*response=await fetch\(ENDPOINT,[\s\S]*body:JSON\.stringify\(payload\)/);
  assert.match(wrapper, /networkFailures\+\+;[\s\S]*networkFailures>8/);
  assert.match(wrapper, /서버 연결 재시도 중/);
});


test('partial workflow results are explicitly labeled and stored as partial', async () => {
  const { sandbox, storage } = makeContext({ workflowStatus: 'partial' });
  const result = await sandbox.callConfiguredLLM([{ role: 'user', content: '검토 업무' }]);
  assert.match(result.text, /부분 완료 · 추가 확인 필요/);
  const history = JSON.parse(storage.get('swV315WorkflowTaskHistory'));
  assert.equal(history[0].status, 'partial');
});

test('integrated wrapper does not label partial or failed results as completed', async () => {
  const wrapper = await readFile(new URL('../office-v315-integrated.html', import.meta.url), 'utf8');
  assert.match(wrapper, /state==='completed'\?'업무 완료':state==='partial'\?'부분 완료 · 추가 확인 필요':'업무 미완료/);
});

test('an interrupted workflow reuses its original task and idempotency keys on the next identical instruction', async () => {
  const { sandbox, calls, storage, setFail } = makeContext({ fail: true });
  const input = [{ role: 'user', content: '계약서 검토 및 수정안 작성' }];
  const first = await sandbox.callConfiguredLLM(input);
  assert.match(first.text, /실제 업무처리 실패/);
  assert.equal(calls.length, 1);
  const firstTaskId = calls[0].taskId;
  const pending = JSON.parse(storage.get('swV315PendingWorkflowTask'));
  assert.equal(pending.state, 'resume_required');
  assert.equal(pending.payload.idempotencyKey, firstTaskId);

  setFail(false);
  const second = await sandbox.callConfiguredLLM(input);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].taskId, firstTaskId);
  assert.equal(calls[1].idempotencyKey, firstTaskId);
  assert.match(second.text, /본부장 최종 보고/);
  assert.equal(storage.has('swV315PendingWorkflowTask'), false);
});

test('a different instruction does not reuse the previous pending task ID', async () => {
  const { sandbox, calls, storage } = makeContext({ fail: true });
  await sandbox.callConfiguredLLM([{ role: 'user', content: '첫 번째 업무' }]);
  const firstTaskId = calls[0].taskId;
  await sandbox.callConfiguredLLM([{ role: 'user', content: '두 번째 업무' }]);
  assert.notEqual(calls[1].taskId, firstTaskId);
  const pending = JSON.parse(storage.get('swV315PendingWorkflowTask'));
  assert.equal(pending.payload.task, '두 번째 업무');
});
