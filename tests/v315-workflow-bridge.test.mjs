import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../workflow-bridge-v315.js', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../office-v315-integrated.html', import.meta.url), 'utf8');

const latestOfficeSource = await readFile(new URL('../SW_AI_Office_Latest.html', import.meta.url), 'utf8');

test('latest office retains all DOM hooks required by the workflow bridge', () => {
  for (const id of ['aiCfgBtn', 'gl', 'stage', 'chat', 'msgs']) {
    assert.ok(latestOfficeSource.includes('id="' + id + '"'), 'missing bridge DOM hook: ' + id);
  }
  const ids = [...latestOfficeSource.matchAll(/ id=["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id attributes found');
});

test('integrated wrapper loads the latest office baseline with the approved representative and team leads', () => {
  assert.ok(wrapperSource.includes('<iframe id="office" title="SW AI OFFICE" src="SW_AI_Office_Latest.html">'));
  assert.ok(latestOfficeSource.includes('["ceo1","피터","대표이사"'));
  assert.ok(latestOfficeSource.includes('["rex","렉스","법무팀장"'));
  assert.ok(latestOfficeSource.includes('["alex","알렉스","본부장"'));
  assert.doesNotMatch(latestOfficeSource, /단테/);
  assert.ok(!latestOfficeSource.includes('["peter","피터","법무팀장"'));
  for (const name of ['데니스', '에이든', '에릭', '렉스', '라이언', '테오']) {
    assert.ok(latestOfficeSource.includes(name), 'missing approved team lead: ' + name);
  }
});


function makeContext({ selectedId = 'alex', fail = false, workflowStatus = 'completed', initialStorage = null } = {}) {
  const calls = [];
  let shouldFail = fail;
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
  const storage = initialStorage || new Map();
  let taskSequence = 0;
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
    crypto: { randomUUID: () => 'test-task-id' + (++taskSequence === 1 ? '' : '-' + taskSequence) },
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
            deliverables: [{ title: '법무 검토서', department: '법무팀', status: '완료', teamLeader: '렉스', content: '검토 결과' }],
            workflow: { status: workflowStatus, reviewGate: { finalReleaseAllowed: workflowStatus === 'completed' } }
          };
        }
      }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'workflow-bridge-v315.js' });
  return { sandbox, calls, storage, progressBubble, employees, setFail: value => { shouldFail = value; } };
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
  assert.equal(calls[0].employees.find(person => person.id === 'COO').name, '피터');
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
  const { sandbox, calls } = makeContext({ selectedId: 'rex' });
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

test('integrated wrapper keeps quota-limited work pending and retries with the same task payload', async () => {
  const wrapper = await readFile(new URL('../office-v315-integrated.html', import.meta.url), 'utf8');
  assert.match(wrapper, /if\(data\.status==='WAITING_FOR_API_QUOTA'\)/);
  assert.match(wrapper, /AI 사용 한도 회복 대기 중 · 업무 기록 보존/);
  assert.match(wrapper, /Math\.min\(300000,Math\.max\(30000,Number\(data\.quotaRetryAfterMs\)\|\|300000\)\)/);
  assert.match(wrapper, /body:JSON\.stringify\(payload\)/);
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

test('a pending workflow survives a fresh browser script context and resumes with the same idempotency key', async () => {
  const persistedStorage = new Map();
  const firstContext = makeContext({ fail: true, initialStorage: persistedStorage });
  const input = [{ role: 'user', content: '브라우저 재시작 후 업무 복구 검증' }];
  const first = await firstContext.sandbox.callConfiguredLLM(input);
  assert.match(first.text, /실제 업무처리 실패/);
  const originalTaskId = firstContext.calls[0].taskId;
  assert.ok(persistedStorage.has('swV315PendingWorkflowTask'));

  // 새 페이지 로드처럼 JavaScript 실행 컨텍스트만 새로 만들고 localStorage는 유지한다.
  const secondContext = makeContext({ initialStorage: persistedStorage });
  const resumed = await secondContext.sandbox.callConfiguredLLM(input);
  assert.equal(secondContext.calls.length, 1);
  assert.equal(secondContext.calls[0].taskId, originalTaskId);
  assert.equal(secondContext.calls[0].idempotencyKey, originalTaskId);
  assert.match(resumed.text, /본부장 최종 보고/);
  assert.equal(persistedStorage.has('swV315PendingWorkflowTask'), false);
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

test('a changed employee roster does not resume an interrupted task with stale assignments', async () => {
  const { sandbox, calls, employees, setFail } = makeContext({ fail: true });
  const input = [{ role: 'user', content: '조직 전체 업무 배정 검토' }];
  await sandbox.callConfiguredLLM(input);
  const firstTaskId = calls[0].taskId;

  employees.find(person => person.id === 'legal' || person.id === 'rex').duty = '변경된 법무 검수 업무';
  setFail(false);
  await sandbox.callConfiguredLLM(input);

  assert.equal(calls.length, 2);
  assert.notEqual(calls[1].taskId, firstTaskId);
  assert.equal(calls[1].employees.find(person => person.id === 'rex').instruction, '변경된 법무 검수 업무');
});

test('an interrupted task older than 24 hours starts with a new task ID', async () => {
  const { sandbox, calls, storage, setFail } = makeContext({ fail: true });
  const input = [{ role: 'user', content: '장기 미완료 업무 재검토' }];
  await sandbox.callConfiguredLLM(input);
  const firstTaskId = calls[0].taskId;
  const pending = JSON.parse(storage.get('swV315PendingWorkflowTask'));
  pending.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  pending.lastAttemptAt = new Date().toISOString();
  storage.set('swV315PendingWorkflowTask', JSON.stringify(pending));

  setFail(false);
  await sandbox.callConfiguredLLM(input);

  assert.equal(calls.length, 2);
  assert.notEqual(calls[1].taskId, firstTaskId);
});

test('integrated wrapper JavaScript parses and includes server-side task recovery', () => {
  const scriptStart = wrapperSource.indexOf('<script>');
  const scriptEnd = wrapperSource.indexOf('</script>', scriptStart);
  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart);
  assert.equal(wrapperSource.indexOf('<script>', scriptStart + 1), -1);
  assert.doesNotThrow(() => new vm.Script(wrapperSource.slice(scriptStart + 8, scriptEnd), { filename: 'office-v315-integrated.html' }));
  assert.match(wrapperSource, /action:'get_recent_tasks'/);
  assert.match(wrapperSource, /const saved=audit\.result\|\|\{\}/);
  assert.match(wrapperSource, /\[본부장 최종 보고\]/);
  assert.match(wrapperSource, /function renderPendingRecovery\(\)/);
  assert.match(wrapperSource, /swV315PendingWorkflowTask/);
  assert.match(wrapperSource, /기존 업무 ID와 멱등성 키를 사용해 이어서 처리/);
  assert.ok(wrapperSource.includes(String.raw`중단 또는 재개 대기 중인 업무가 있습니다.\n업무 ID:`));
  assert.match(wrapperSource, /직원 명단이 바뀌면 새 업무로 접수/);
});


test('latest uploaded office HTML is the live visual shell while the approved original remains untouched', async () => {
  const { createHash } = await import('node:crypto');
  const original = await readFile(new URL('../SW_AI_Office_v3_15.html', import.meta.url), 'utf8');
  const office = await readFile(new URL('../SW_AI_Office_Latest.html', import.meta.url), 'utf8');
  const gitBlobSha = createHash('sha1').update(Buffer.from('blob ' + Buffer.byteLength(original) + '\0')).update(original).digest('hex');
  assert.equal(gitBlobSha, '5b42a3c1ee8bfdff1b5141057b0db21e2517d5c3');
  assert.ok(office.includes('async function callConfiguredLLM(inputMsgs)'));
  assert.ok(office.includes('const r=await callConfiguredLLM(input)'));
  assert.ok(office.includes('["ceo1","피터","대표이사"'));
  assert.ok(office.includes('["rex","렉스","법무팀장"'));
  assert.ok(wrapperSource.includes('src="SW_AI_Office_Latest.html"'));
  assert.ok(wrapperSource.includes("script.src='workflow-bridge-v315.js'"));
  assert.ok(source.includes('window.callConfiguredLLM = async function (inputMsgs)'));
  assert.ok(source.includes("selected && selected.id === 'alex'"));
  assert.ok(source.includes('originalCallConfiguredLLM(inputMsgs)'));
});


test('workflow engine control is injected beside the original office settings button', () => {
  assert.match(wrapperSource, /const header=doc\.querySelector\('header'\)/);
  assert.match(wrapperSource, /const settingsButton=doc\.getElementById\('aiCfgBtn'\)/);
  assert.match(wrapperSource, /settingsButton\.insertAdjacentElement\('afterend',button\)/);
  assert.match(wrapperSource, /button\.id='swWorkflowEngineButton'/);
  assert.match(wrapperSource, /button\.textContent='업무 엔진'/);
  assert.match(wrapperSource, /button\.addEventListener\('click',\(\)=>\{const opened=panel\.classList\.toggle\('open'\)/);
  assert.match(wrapperSource, /if\(opened\)renderHistory\(\)/);
  assert.match(wrapperSource, /button\.setAttribute\('aria-expanded','false'\)/);
  assert.match(wrapperSource, /button\.setAttribute\('aria-label',opened\?'업무 엔진 닫기':'업무 엔진 열기'\)/);
  assert.match(wrapperSource, /button\.setAttribute\('aria-expanded',String\(opened\)\)/);
});

test('workflow engine control does not replace or mutate the approved office HTML', async () => {
  const office = await readFile(new URL('../SW_AI_Office_v3_15.html', import.meta.url), 'utf8');
  assert.ok(office.includes('async function callConfiguredLLM(inputMsgs)'));
  assert.ok(!office.includes('swWorkflowEngineButton'));
  assert.match(wrapperSource, /src="SW_AI_Office_Latest\.html"/);
  assert.match(wrapperSource, /if\(doc\.getElementById\('sw-workflow-bridge-v315'\)\)return/);
  assert.doesNotMatch(wrapperSource, /id="bridgeToggle"/);
});


test('renders server and task content without unsafe HTML injection sinks', () => {
  assert.doesNotMatch(wrapperSource, /\.innerHTML\s*=|\.insertAdjacentHTML\s*\(/);
  assert.doesNotMatch(source, /\.innerHTML\s*=|\.insertAdjacentHTML\s*\(/);
  assert.match(wrapperSource, /textContent/);
  assert.match(source, /textContent/);
});
