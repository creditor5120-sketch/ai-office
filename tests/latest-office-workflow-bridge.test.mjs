import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const bridgeSource = await readFile(new URL('../workflow-bridge-latest.js', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../office-v315-integrated.html', import.meta.url), 'utf8');
const latestOfficeSource = await readFile(new URL('../SW_AI_Office_Latest.html', import.meta.url), 'utf8');

function makeContext({ selectedId = 'alex', fail = false } = {}) {
  const calls = [];
  const handlers = {};
  const storage = new Map();
  const input = { value: '계약서 검토 및 수정안 작성' };
  const messages = { scrollTop: 0, scrollHeight: 100 };
  const employees = [
    { id: 'alex', name: '알렉스', badge: '본부장', room: 'hq', duty: '전사 업무 분석 및 배정' },
    { id: 'ceo1', name: '피터', badge: '대표이사', room: 'ceo', duty: '최종 의사결정' },
    { id: 'denis', name: '데니스', badge: '경영관리팀장', room: 'shared', duty: '경영관리 검수' },
    { id: 'aiden', name: '에이든', badge: '총무팀장', room: 'shared', duty: '총무 검수' },
    { id: 'eric', name: '에릭', badge: '전략기획팀장', room: 'shared', duty: '전략기획 검수' },
    { id: 'rex', name: '렉스', badge: '법무팀장', room: 'legal', duty: '법무 검수' },
    { id: 'ryan', name: '라이언', badge: 'IR팀장', room: 'ir', duty: 'IR 검수' },
    { id: 'teo', name: '테오', badge: 'IT·기술팀장', room: 'it', duty: '기술 검수' }
  ];
  const st = { sel: selectedId, robotChat: false, wfRun: false, file: null, hist: {}, phase: {}, busy: {} };
  const sandbox = {
    EMP: employees, st, E: id => employees.find(person => person.id === id),
    inp: input, msgs: messages,
    T: () => '09:30',
    setPhase: (id, label) => { if (label) { st.phase[id] = label; st.busy[id] = true; } else { delete st.phase[id]; st.busy[id] = false; } },
    drawCards: () => {}, drawChat: () => {},
    crypto: { randomUUID: () => 'test-task-001' },
    CustomEvent: function CustomEvent(name) { this.type = name; },
    dispatchEvent: () => true,
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    document: {
      addEventListener: (name, fn, capture) => { handlers[name] = { fn, capture }; },
      getElementById: id => id === 'inp' ? input : id === 'hint' ? { textContent: '' } : null
    },
    parent: {
      SWWorkflowBridge: {
        execute: async (payload, onProgress) => {
          calls.push(payload);
          if (onProgress) onProgress({ currentStage: '전문 직원 수행' });
          if (fail) throw new Error('서버 인증값이 설정되지 않았습니다.');
          return {
            reply: '본부장 최종 보고',
            deliverables: [{ title: '법무 검토서', department: '법무팀', status: '완료', teamLeader: '렉스', content: '검토 결과' }],
            workflow: { status: 'completed', reviewGate: { finalReleaseAllowed: true } }
          };
        }
      }
    },
    setTimeout
  };
  sandbox.window = sandbox;
  vm.runInNewContext(bridgeSource, sandbox, { filename: 'workflow-bridge-latest.js' });
  return { sandbox, calls, handlers, storage, input, st, employees };
}

test('canonical latest office remains the iframe baseline and loads the dedicated adapter', () => {
  assert.ok(wrapperSource.includes('src="SW_AI_Office_Latest.html"'));
  assert.ok(wrapperSource.includes("script.src='workflow-bridge-latest.js'"));
  assert.ok(latestOfficeSource.includes('async function runDirective(text,f)'));
  assert.ok(latestOfficeSource.includes('const EMP=['));
});

test('Alex send is intercepted and passed to the Worker with COO and approved team roster', async () => {
  const { sandbox, calls, handlers, storage, input, st } = makeContext();
  const event = {
    target: { closest: selector => selector === '#send' ? {} : null },
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  };
  handlers.click.fn(event);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task, '계약서 검토 및 수정안 작성');
  assert.equal(calls[0].employeeId, 'alex');
  assert.equal(calls[0].employees.find(person => person.id === 'COO').name, '피터');
  for (const team of ['경영관리팀', '총무팀', '전략기획팀', '법무팀', 'IR팀', '기술·IT팀']) {
    assert.ok(calls[0].employees.some(person => person.department === team && person.position.includes('팀장')), team);
  }
  assert.equal(input.value, '');
  assert.equal(st.wfRun, false);
  assert.match(st.hist.alex.at(-1).content, /본부장 최종 보고/);
  assert.match(st.hist.alex.at(-1).content, /법무 검토서/);
  assert.equal(storage.has('swV315PendingWorkflowTask'), false);
});

test('Worker errors are visible and the pending task is preserved for retry', async () => {
  const { handlers, storage, input, st } = makeContext({ fail: true });
  const event = {
    target: { closest: selector => selector === '#send' ? {} : null },
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}
  };
  handlers.click.fn(event);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(st.wfRun, false);
  assert.match(st.hist.alex.at(-1).content, /실제 업무처리 실패/);
  assert.match(st.hist.alex.at(-1).content, /인증값이 설정되지 않았습니다/);
  const pending = JSON.parse(storage.get('swV315PendingWorkflowTask'));
  assert.equal(pending.state, 'resume_required');
  assert.equal(pending.payload.taskId, 'test-task-001');
  assert.equal(input.value, '');
});

test('non-Alex conversations are not intercepted', () => {
  const { handlers, calls } = makeContext({ selectedId: 'rex' });
  let prevented = false;
  handlers.click.fn({
    target: { closest: selector => selector === '#send' ? {} : null },
    preventDefault() { prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}
  });
  assert.equal(prevented, false);
  assert.equal(calls.length, 0);
});
