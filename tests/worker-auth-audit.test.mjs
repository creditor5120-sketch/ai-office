import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../worker/SW_AI_OFFICE_Worker_v51_22_completion_audit.js', import.meta.url), 'utf8');
const executable = source.replace('export default {', 'const worker = {') + '\n;globalThis.__worker = worker;';
const sandbox = { crypto: webcrypto, Request, Response, Headers, URL, console, TextEncoder, TextDecoder, setTimeout, clearTimeout };
vm.runInNewContext(executable, sandbox, { filename: 'SW_AI_OFFICE_Worker_v51_22_completion_audit.js' });
const worker = sandbox.__worker;

class FakeD1 {
  constructor({ status = 'COMPLETED', releaseAllowed = true } = {}) {
    this.task = {
      task_id: 'test-task-001',
      task: '테스트 업무',
      status,
      current_stage: '최종 보고',
      created_at: '2026-11-19T00:00:00.000Z',
      updated_at: '2026-11-19T00:01:00.000Z',
      completed_at: '2026-11-19T00:01:00.000Z',
      error_message: null,
      partial_result_json: JSON.stringify({ taskId: 'test-task-001', reply: '서버에 저장된 보고서', deliverables: [{ title: '결과물 1', content: '저장된 내용' }], workflow: { resultStatus: '검수 완료', reviewGate: { finalReleaseAllowed: releaseAllowed } } })
    };
    this.events = [];
    this.recentTasks = [];
  }
  prepare(sql) {
    const db = this;
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (sql.includes('FROM tasks')) return db.task && db.task.task_id === args[0] ? { ...db.task } : null;
        if (sql.includes("event_type = 'REPRESENTATIVE_DECISION'")) {
          // 두 요청이 모두 기존 결정 없음(prior=null)을 확인한 뒤 INSERT 경쟁에 진입하도록 동기화한다.
          if (db.forceConcurrentPriorReads) {
            db.concurrentPriorReadCount = (db.concurrentPriorReadCount || 0) + 1;
            if (db.concurrentPriorReadCount === 2) {
              db.forceConcurrentPriorReads = false;
              for (const release of db.concurrentPriorReadWaiters.splice(0)) release();
            } else if (db.concurrentPriorReadCount === 1) {
              await new Promise(resolve => db.concurrentPriorReadWaiters.push(resolve));
            }
          }
          const event = db.events.find(x => x.task_id === args[0]);
          return event ? { detail_json: event.detail_json, created_at: event.created_at } : null;
        }
        return null;
      },
      async all() {
        if (sql.includes('FROM tasks')) {
          return { results: db.recentTasks.length ? db.recentTasks : [{ ...db.task }] };
        }
        if (sql.includes('FROM task_events')) {
          const rows = db.events
            .map((event, index) => ({ ...event, __rowid: index }))
            .filter(event => event.task_id === args[0])
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.__rowid - a.__rowid)
            .slice(0, 301)
            .map(({ __rowid, ...event }) => event);
          return { results: rows };
        }
        return { results: [] };
      },
      async run() {
        if (sql.includes("INSERT INTO task_events") && sql.includes("'REPRESENTATIVE_DECISION'")) {
          if (db.events.some(x => x.task_id === args[1])) return { meta: { changes: 0 } };
          db.events.push({
            event_id: args[0], task_id: args[1], event_type: 'REPRESENTATIVE_DECISION',
            actor: args[2], stage: args[3], detail_json: args[4], created_at: args[5]
          });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }
}

const ACCESS = 'test-general-access-secret';
const REPRESENTATIVE = 'test-representative-secret';
async function call(body, { access = ACCESS, representative = REPRESENTATIVE, db = new FakeD1(), rawBody = null, extraHeaders = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (access !== null) headers.Authorization = 'Bearer ' + access;
  if (representative !== null) headers['X-Representative-Authorization'] = 'Bearer ' + representative;
  const request = new Request('https://worker.test/', { method: 'POST', headers, body: rawBody === null ? JSON.stringify(body) : rawBody });
  const env = { OFFICE_ACCESS_TOKEN: ACCESS, REPRESENTATIVE_ACCESS_TOKEN: REPRESENTATIVE, DB: db };
  const response = await worker.fetch(request, env);
  return { status: response.status, body: await response.json(), db };
}

test('rejects missing and incorrect general API credentials', async () => {
  assert.equal((await call({ action: 'get_task_history', taskId: 'test-task-001' }, { access: null })).status, 401);
  assert.equal((await call({ action: 'get_task_history', taskId: 'test-task-001' }, { access: 'wrong' })).status, 401);
});

test('requires the separate representative credential', async () => {
  assert.equal((await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' }, { representative: null })).status, 401);
  assert.equal((await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' }, { representative: 'wrong' })).status, 401);
});

test('requires a reason for rejection and a completed task', async () => {
  const missingReason = await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'REJECT' });
  assert.equal(missingReason.status, 400);
  const pending = await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' }, { db: new FakeD1({ status: 'PROCESSING' }) });
  assert.equal(pending.status, 409);
});

test('blocks approval unless final review gate is passed', async () => {
  const result = await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' }, { db: new FakeD1({ releaseAllowed: false }) });
  assert.equal(result.status, 409);
  assert.equal(result.db.events.length, 0);
});

test('records one immutable approval and supports read-back', async () => {
  const db = new FakeD1({ releaseAllowed: true });
  const first = await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' }, { db });
  assert.equal(first.status, 200);
  assert.equal(first.body.decision, 'APPROVE');
  assert.equal(db.events.length, 1);

  const duplicate = await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' }, { db });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(db.events.length, 1);

  const conflict = await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'REJECT', reason: '재검토 필요' }, { db });
  assert.equal(conflict.status, 409);
  assert.equal(db.events.length, 1);

  const readBack = await call({ action: 'get_representative_decision', taskId: 'test-task-001' }, { db });
  assert.equal(readBack.status, 200);
  assert.equal(readBack.body.decision, 'APPROVE');
});

test('lists recent tasks from server storage without relying on browser history', async () => {
  const db = new FakeD1();
  db.recentTasks = [
    { task_id: 'task-new', task: '새 업무', status: 'COMPLETED', current_stage: '최종 보고', created_at: '2026-11-20T02:00:00.000Z', updated_at: '2026-11-20T02:01:00.000Z', completed_at: '2026-11-20T02:01:00.000Z', error_message: null },
    { task_id: 'task-old', task: '이전 업무', status: 'PARTIAL_COMPLETED', current_stage: '검수', created_at: '2026-11-19T02:00:00.000Z', updated_at: '2026-11-19T02:01:00.000Z', completed_at: '2026-11-19T02:01:00.000Z', error_message: '일부 미완료' }
  ];
  const result = await call({ action: 'get_recent_tasks', limit: 20 }, { db });
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 2);
  assert.equal(result.body.tasks[0].taskId, 'task-new');
  assert.equal(result.body.tasks[1].error, '일부 미완료');
});

test('caps recent task list requests and fails closed without D1', async () => {
  const db = new FakeD1();
  const capped = await call({ action: 'get_recent_tasks', limit: 5000 }, { db });
  assert.equal(capped.status, 200);
  assert.match(source, /Math\.min\(50, Math\.max\(1, Math\.floor\(requestedLimit\)\)\)/);
  const unavailable = await call({ action: 'get_recent_tasks' }, { db: null });
  assert.equal(unavailable.status, 503);
});

test('returns saved final report and deliverables with task audit history', async () => {
  const result = await call({ action: 'get_task_history', taskId: 'test-task-001' });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.reply, '서버에 저장된 보고서');
  assert.equal(result.body.result.deliverables[0].content, '저장된 내용');
  assert.equal(result.body.task.taskId, 'test-task-001');
});

test('returns workflow audit events from D1', async () => {
  const db = new FakeD1();
  db.events.push({ event_id: 'evt-1', task_id: 'test-task-001', event_type: 'WORKFLOW_STAGE_STARTED', actor: 'tester', stage: '전문 직원 수행', detail_json: JSON.stringify({ responsibleRole: '법무팀장' }), created_at: '2026-11-19T00:00:30.000Z' });
  const result = await call({ action: 'get_task_history', taskId: 'test-task-001' }, { db });
  assert.equal(result.status, 200);
  assert.equal(result.body.eventCount, 1);
  assert.equal(result.body.events[0].detail.responsibleRole, '법무팀장');
});

test('serves CORS preflight without API credentials', async () => {
  const request = new Request('https://worker.test/', { method: 'OPTIONS' });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://creditor5120-sketch.github.io');
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /X-Representative-Authorization/);
});

test('allows the configured Pages preview origin for browser workflow testing', async () => {
  const origin = 'https://work-v315-office-workflow-br.sw-ai-office-preview.pages.dev';
  const request = new Request('https://worker.test/', { method: 'OPTIONS', headers: { Origin: origin } });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Vary'), 'Origin');
});

test('does not reflect untrusted origins in CORS headers', async () => {
  const origin = 'https://untrusted.example';
  const request = new Request('https://worker.test/', { method: 'OPTIONS', headers: { Origin: origin } });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 200);
  assert.notEqual(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('fails closed when the server API secret is not configured', async () => {
  const request = new Request('https://worker.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-general-access-secret' },
    body: JSON.stringify({ action: 'get_task_history', taskId: 'test-task-001' })
  });
  const response = await worker.fetch(request, { DB: new FakeD1() });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /인증 비밀값/);
});

test('rejects non-POST requests', async () => {
  const request = new Request('https://worker.test/', { method: 'GET' });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 405);
});

test('fails closed when the representative-only secret is missing', async () => {
  const db = new FakeD1();
  const request = new Request('https://worker.test/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + ACCESS,
      'X-Representative-Authorization': 'Bearer ' + REPRESENTATIVE
    },
    body: JSON.stringify({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' })
  });
  const response = await worker.fetch(request, { OFFICE_ACCESS_TOKEN: ACCESS, DB: db });
  assert.equal(response.status, 503);
  assert.equal(db.events.length, 0);
});

test('fails closed when D1 is unavailable for a representative decision', async () => {
  const request = new Request('https://worker.test/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + ACCESS,
      'X-Representative-Authorization': 'Bearer ' + REPRESENTATIVE
    },
    body: JSON.stringify({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' })
  });
  const response = await worker.fetch(request, {
    OFFICE_ACCESS_TOKEN: ACCESS,
    REPRESENTATIVE_ACCESS_TOKEN: REPRESENTATIVE
  });
  assert.equal(response.status, 503);
});

test('rejects unknown explicit API actions without starting a task', async () => {
  const result = await call({ action: 'delete_everything', task: 'should never execute', employees: [{ id: 'COO' }] });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /지원하지 않는 API action/);
  assert.equal(result.db.events.length, 0);
});

test('returns HTTP 400 for malformed JSON without entering task execution', async () => {
  const request = new Request('https://worker.test/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + ACCESS
    },
    body: '{"action":'
  });
  const response = await worker.fetch(request, {
    OFFICE_ACCESS_TOKEN: ACCESS,
    REPRESENTATIVE_ACCESS_TOKEN: REPRESENTATIVE,
    DB: new FakeD1()
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /올바른 JSON 형식/);
});

test('rejects non-object JSON bodies and non-string explicit actions', async () => {
  const nullBody = await call(null);
  assert.equal(nullBody.status, 400);
  assert.match(nullBody.body.error, /JSON 객체/);

  const numericAction = await call({ action: 123, task: 'should never execute', employees: [{ id: 'COO' }] });
  assert.equal(numericAction.status, 400);
  assert.match(numericAction.body.error, /지원하지 않는 API action/);
});


test('validates task-history identifiers and reports missing tasks', async () => {
  const empty = await call({ action: 'get_task_history', taskId: '   ' });
  assert.equal(empty.status, 400);
  const missing = await call({ action: 'get_task_history', taskId: 'missing-task' });
  assert.equal(missing.status, 404);
});

test('preserves malformed audit JSON as a visible parse error', async () => {
  const db = new FakeD1();
  db.events.push({
    event_id: 'evt-bad-json',
    task_id: 'test-task-001',
    event_type: 'WORKFLOW_STAGE_STARTED',
    actor: 'tester',
    stage: '검수',
    detail_json: '{invalid-json',
    created_at: '2026-11-19T00:00:30.000Z'
  });
  const result = await call({ action: 'get_task_history', taskId: 'test-task-001' }, { db });
  assert.equal(result.status, 200);
  assert.equal(result.body.events[0].detail.parseError, '이력 상세 JSON을 해석하지 못했습니다.');
});


test('returns only the newest 300 audit events in chronological order', async () => {
  const db = new FakeD1();
  for (let i = 0; i < 305; i++) {
    db.events.push({
      event_id: 'evt-' + String(i).padStart(3, '0'),
      task_id: 'test-task-001',
      event_type: 'WORKFLOW_STAGE_STARTED',
      actor: 'tester',
      stage: '단계 ' + i,
      detail_json: JSON.stringify({ sequence: i }),
      created_at: new Date(Date.UTC(2026, 10, 19, 0, 0, i)).toISOString()
    });
  }
  const result = await call({ action: 'get_task_history', taskId: 'test-task-001' }, { db });
  assert.equal(result.status, 200);
  assert.equal(result.body.eventCount, 300);
  assert.equal(result.body.truncated, true);
  assert.equal(result.body.events[0].detail.sequence, 5);
  assert.equal(result.body.events.at(-1).detail.sequence, 304);
  assert.equal(result.body.events[0].createdAt <= result.body.events.at(-1).createdAt, true);
});


test('fails closed when D1 is unavailable for task-history reads', async () => {
  const result = await call({ action: 'get_task_history', taskId: 'test-task-001' }, { db: null });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /D1 DB 바인딩/);
});

test('rejects invalid representative decisions and unknown task IDs', async () => {
  const invalid = await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'MAYBE' });
  assert.equal(invalid.status, 400);
  const missing = await call({ action: 'representative_decision', taskId: 'missing-task', decision: 'APPROVE' });
  assert.equal(missing.status, 404);
});

test('concurrent opposite representative decisions preserve exactly one immutable first decision', async () => {
  const db = new FakeD1({ releaseAllowed: true });
  db.forceConcurrentPriorReads = true;
  db.concurrentPriorReadWaiters = [];
  const [approve, reject] = await Promise.all([
    call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' }, { db }),
    call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'REJECT', reason: '동시 반려 요청' }, { db })
  ]);
  assert.equal(db.events.length, 1);
  assert.equal([approve.status, reject.status].filter(status => status === 200).length, 1);
  assert.equal([approve.status, reject.status].filter(status => status === 409).length, 1);
  const stored = JSON.parse(db.events[0].detail_json);
  assert.ok(['APPROVE', 'REJECT'].includes(stored.decision));
  assert.equal(stored.decision, approve.status === 200 ? 'APPROVE' : 'REJECT');
});

test('returns an explicit empty representative decision before a decision is recorded', async () => {
  const result = await call({ action: 'get_representative_decision', taskId: 'test-task-001' });
  assert.equal(result.status, 200);
  assert.equal(result.body.taskId, 'test-task-001');
  assert.equal(result.body.decision, null);
  assert.equal(result.body.recordedAt, null);
});

test('returns the immutable representative decision from the audit event', async () => {
  const db = new FakeD1({ releaseAllowed: true });
  const saved = await call({ action: 'representative_decision', taskId: 'test-task-001', decision: 'REJECT', reason: '근거 보완 필요' }, { db });
  assert.equal(saved.status, 200);
  const fetched = await call({ action: 'get_representative_decision', taskId: 'test-task-001' }, { db });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.decision, 'REJECT');
  assert.equal(fetched.body.reason, '근거 보완 필요');
  assert.equal(fetched.body.recordedAt, saved.body.recordedAt);
});


test('keeps the configured OpenRouter key compatible and provides Gemini fallback', () => {
  assert.match(source, /env\.OPENROUTER_API_KEY\s*\?\s*"openrouter"\s*:\s*env\.GEMINI_API_KEY\s*\?\s*"gemini"/);
  assert.match(source, /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.match(source, /https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
  assert.match(source, /OPENROUTER_API_KEY 또는 GEMINI_API_KEY/);
});


test('allows an interrupted RECEIVED task to enter the guarded resume path', () => {
  assert.doesNotMatch(source, /if \(savedTask\.status === "RECEIVED"\)\s*\{\s*return json\(\{ error: "동일한 업무가 이미 접수되어 처리 대기 중입니다\."/);
  assert.match(source, /UPDATE tasks SET status = 'PROCESSING'[\s\S]*WHERE task_id = \?/);
  assert.match(source, /WHERE task_id = \? AND \(lock_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= \?\)/);
});


test('resume rejects malformed or misindexed saved checkpoints before making another AI call', () => {
  const loadStart = source.indexOf('for (const row of (savedCheckpoints.results || []))');
  const loadEnd = source.indexOf('await writeTaskEvent("TASK_LOCK_ACQUIRED"', loadStart);
  const loadBlock = source.slice(loadStart, loadEnd);
  assert.match(loadBlock, /catch \(_\) \{ throw new Error\("SW_AI_CHECKPOINT_CORRUPT"\); \}/);
  assert.match(loadBlock, /Number\(match\[1\]\) !== saved\.index/);
  assert.ok(source.includes("substr(stage_key, 1, 12) = 'v51_ai_call_'"));
  assert.match(loadBlock, /typeof saved\.signature !== "string" \|\| typeof saved\.value !== "string"/);
  assert.doesNotMatch(loadBlock, /catch \(_\) \{\s*\}/);
});

test('resume verifies contiguous AI checkpoints against the task-level checkpoint pointer', () => {
  assert.ok(source.includes('checkpoint_stage, checkpoint_json, execution_version FROM tasks WHERE idempotency_key'));
  assert.ok(source.includes('let expectedCheckpointIndex = 0'));
  assert.ok(source.includes('saved.index !== expectedCheckpointIndex'));
  assert.ok(source.includes('taskCheckpoint.lastAiCallIndex !== lastIndex'));
  assert.ok(source.includes('taskCheckpoint.resumeStrategy !== "signature_checked_replay"'));
  assert.ok(source.includes('cachedAiCalls.size === 0'));
  assert.ok(source.includes('throw new Error("SW_AI_CHECKPOINT_CORRUPT")'));
});

test('checkpoint replay distinguishes an identical saved result from a conflicting result', () => {
  assert.match(source, /SELECT checkpoint_json FROM task_checkpoints WHERE task_id = \? AND stage_key = \?/);
  assert.match(source, /saved\.signature !== signature \|\| saved\.value !== value/);
  assert.match(source, /if \(!raced\) throw new Error\("SW_AI_LOCK_LOST"\)/);
  assert.match(source, /SW_AI_CHECKPOINT_CONFLICT/);
  assert.match(source, /SW_AI_CHECKPOINT_CORRUPT/);
  assert.match(source, /idempotentReuse: reusedExisting/);
  assert.match(source, /if \(cached\.signature !== signature\)\s*\{\s*throw new Error\("SW_AI_CHECKPOINT_CONFLICT"\);\s*\}/);
  assert.ok(source.indexOf('if (cached.signature !== signature)') < source.indexOf('const value = await askAIBare(effectiveSystemPrompt'));
});


test('persists quota exhaustion as a resumable waiting state with checkpoint metadata', () => {
  assert.match(source, /nextStatus === "WAITING_FOR_API_QUOTA"/);
  assert.match(source, /nextStatus === "WAITING_FOR_API_QUOTA"\s*\?\s*"TASK_WAITING_FOR_QUOTA"/);
  assert.match(source, /cachedAiCallCount: cachedAiCalls\.size/);
  assert.match(source, /nextAiCallIndex: aiCallCursor/);
  assert.match(source, /nextStatus === "WAITING_FOR_API_QUOTA" \? 429/);
  assert.match(source, /같은 taskId와 idempotencyKey로 다시 요청하면 저장된 AI 결과를 재사용해 이어서 처리합니다/);
});

test('uses an eight-minute execution lease covering provider retries plus one output-continuation call', () => {
  assert.ok(source.includes('const TASK_LOCK_LEASE_MS = 8 * 60 * 1000'));
  assert.equal(source.split('Date.now() + TASK_LOCK_LEASE_MS').length - 1, 2);
  assert.match(source, /for \(let attempt = 0; attempt <= 2; attempt\+\+\)/);
  assert.match(source, /AbortSignal\.timeout\(60000\)/);
  assert.match(source, /continuationDepth < 1/);
  assert.match(source, /continuationDepth \+ 1/);
  const maximumProviderWaitMs = 3 * 60000 + 1200 + 2400;
  const maximumWithOneContinuation = maximumProviderWaitMs * 2;
  assert.ok(8 * 60 * 1000 > maximumWithOneContinuation);
  assert.ok(8 * 60 * 1000 - maximumWithOneContinuation >= 50000);
});

test('acquires execution ownership and increments attempt count in one conditional update', () => {
  const lockStart = source.indexOf("UPDATE tasks SET status = 'PROCESSING',");
  const attemptUpdate = source.indexOf('attempt_count = attempt_count + 1', lockStart);
  const tokenUpdate = source.indexOf('lock_token = ?, lease_expires_at = ?', lockStart);
  const guardedWhere = source.indexOf('WHERE task_id = ? AND (lock_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)', lockStart);
  assert.ok(lockStart >= 0 && attemptUpdate > lockStart && tokenUpdate > attemptUpdate && guardedWhere > tokenUpdate);
  assert.ok(source.includes('.bind(now, lockToken, leaseUntil, leaseNow, taskId, leaseNow).run()'));
  assert.ok(source.includes('WHERE task_id = ? AND lock_token = ?'));
});

test('an expired execution lease cannot be renewed even if its old token remains on the row', () => {
  const renewStart = source.indexOf('const renewTaskLock = async () =>');
  const renewEnd = source.indexOf('const checkTaskControl = async () =>', renewStart);
  const renewBlock = source.slice(renewStart, renewEnd);
  assert.ok(renewBlock.includes('WHERE task_id = ? AND lock_token = ? AND lease_expires_at > ?'));
  assert.ok(renewBlock.includes('.bind(expires, now, taskId, lockToken, now).run()'));
});

test('normal request yielding is not written to the AI failure audit log', () => {
  const catchStart = source.indexOf('} catch (error) {', source.indexOf('const aiCallStartedAt'));
  const catchEnd = source.indexOf('function parseJSON', catchStart);
  const catchBlock = source.slice(catchStart, catchEnd);
  assert.match(catchBlock, /if \(error\.message !== "SW_AI_YIELD"\)/);
  assert.ok(catchBlock.indexOf('if (error.message !== "SW_AI_YIELD")') < catchBlock.indexOf('writeTaskEvent("AI_CALL_FAILED"'));
});

test('a stale execution cannot renew its lease or overwrite task state after ownership changes', () => {
  assert.ok(source.includes('UPDATE tasks SET lease_expires_at = ?, updated_at = ?'));
  assert.ok(source.includes('WHERE task_id = ? AND lock_token = ?'));
  assert.ok(source.includes('partial_result_json = COALESCE(?, partial_result_json)'));
  assert.ok(source.includes('WHERE task_id = ? AND lock_token = ?'));
  assert.ok(source.includes('WHERE EXISTS (SELECT 1 FROM tasks WHERE task_id = ? AND lock_token = ? AND lease_expires_at > ?)'));
  assert.ok(source.includes("AND lease_expires_at > ? AND (? = 0 OR control_request NOT IN ('PAUSE', 'CANCEL'))"));
});

test('cancellation clears the execution lease and does not overwrite completed results', () => {
  const completedAt = source.indexOf('if (savedTask.status === "COMPLETED" || savedTask.status === "PARTIAL_COMPLETED")');
  const cancelAt = source.indexOf('if (String(savedTask.control_request || "NONE").toUpperCase() === "CANCEL")');
  assert.ok(completedAt >= 0 && cancelAt > completedAt);
  assert.match(source, /SET status = 'CANCELLED', lock_token = NULL, lease_expires_at = NULL/);
  assert.ok(source.includes('WHERE task_id = ? AND (lock_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)'));
});


test('records lock release before clearing ownership to preserve audit event order', () => {
  const start = source.indexOf('const releaseTaskLock = async () =>');
  const end = source.indexOf('const renewTaskLock = async () =>', start);
  const block = source.slice(start, end);
  assert.ok(block.indexOf('writeTaskEvent("TASK_LOCK_RELEASED"') < block.indexOf('UPDATE tasks SET lock_token = NULL'));
  assert.ok(block.indexOf('UPDATE tasks SET lock_token = NULL') < block.indexOf('lockToken = null'));
});

test('guards in-flight audit events with the current unexpired lock owner', () => {
  assert.ok(source.includes('WHERE EXISTS (SELECT 1 FROM tasks WHERE task_id = ? AND lock_token = ? AND lease_expires_at > ?)'));
  assert.ok(source.includes('if (lockToken)'));
  assert.ok(source.includes('eventAt, taskId, lockToken, eventAt'));
});


test('requires an unexpired lease to commit successful completion or failure state', () => {
  assert.ok(source.includes("WHERE task_id = ? AND lock_token = ? AND lease_expires_at > ?"));
  assert.ok(source.includes('null, completionAt, completionAt, completionAt, taskId, lockToken, completionAt'));
  assert.ok(source.includes("WHERE task_id = ? AND lock_token = ? AND lease_expires_at > ?"));
  assert.ok(source.includes('failureAt, taskId, lockToken, failureAt'));
  assert.ok(source.includes('SELECT 1 FROM tasks WHERE task_id = ? AND lock_token = ? AND lease_expires_at > ? AND status = ? AND completed_at = ?'));
});



test('workflow execution preserves the agreed analyze-assign-execute-review-revise-recheck-report sequence', () => {
  const stages = [
    '본부장 업무 분석 및 배정',
    '본부장 실행계획 수립',
    '전문 직원 완성본 작성',
    '팀장 1차 검수',
    '전문 직원 결과물 수정',
    '팀장 2차 최종 검수',
    '본부장 최종 검토 및 보고'
  ];
  const positions = stages.map(stage => source.indexOf('await setCurrentStage("' + stage + '"'));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.ok(source.includes('모든 전문 직원 결과물이 completed 상태이고 팀장 2차 검수 judgment가 승인인 경우에만 최종 완료'));
  assert.ok(source.includes('사용자의 명시적 승인 없이 계약 체결, 투자 실행, 대외 공시, 외부 발송을 완료한 것으로 판단하지 않는다.'));
  assert.ok(source.includes('사실, 분석, 제안, 가정 및 미확인 사항을 구분한다.'));
});

test('D1 preflight remains read-only and checks schema, indexes, integrity, and orphan records', async () => {
  const sql = await readFile(new URL('../docs/D1_READ_ONLY_PREFLIGHT.sql', import.meta.url), 'utf8');
  const executable = sql.replace(/^\\s*--.*$/gm, '').trim();
  assert.doesNotMatch(executable, /\\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\\b/i);
  assert.match(sql, /PRAGMA table_info/);
  assert.match(sql, /pragma_index_list/);
  assert.match(sql, /pragma_index_info/);
  assert.match(sql, /PRAGMA integrity_check/);
  assert.match(sql, /PRAGMA foreign_key_check/);
  assert.match(sql, /task_events_without_task/);
  assert.match(sql, /task_checkpoints_without_task/);
});


test('requires a verifiable body quotation before treating a review issue as reconciled', () => {
  const start = source.indexOf('const missingFirstReviewIssues = firstReviewIssues.filter(issue =>');
  const end = source.indexOf('for (const missingIssue of missingFirstReviewIssues)', start);
  const block = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /const evidenceQuotedInBody = quote\.length >= 12 && normalizedDeliverable\.includes\(quote\)/);
  assert.match(block, /return issueMatched && evidenceQuotedInBody;/);
});


test('rejects oversized request bodies before attempting JSON parsing', async () => {
  const tooLarge = await call(null, { rawBody: ' '.repeat(1_500_001), db: null });
  assert.equal(tooLarge.status, 413);
  assert.match(tooLarge.body.error, /1,500,000바이트/);

  const declaredTooLarge = await call(null, {
    rawBody: '{}',
    extraHeaders: { 'Content-Length': '1500001' },
    db: null
  });
  assert.equal(declaredTooLarge.status, 413);
});

test('rejects malformed and oversized workflow request payloads before touching D1', async () => {
  const validEmployees = [{ id: 'COO', name: '피터', department: '대표이사실', position: '대표이사', instruction: '' }];
  const nonStringTask = await call({ task: { text: '업무' }, employees: validEmployees }, { db: null });
  assert.equal(nonStringTask.status, 400);
  assert.match(nonStringTask.body.error, /문자열/);

  const oversizedTask = await call({ task: '가'.repeat(100001), employees: validEmployees }, { db: null });
  assert.equal(oversizedTask.status, 413);

  const malformedEmployee = await call({ task: '테스트 업무', employees: [null, validEmployees[0]] }, { db: null });
  assert.equal(malformedEmployee.status, 400);
  assert.match(malformedEmployee.body.error, /직원 명단/);
});

test('bounds task identifiers and employee fields before persisting a workflow request', async () => {
  const validEmployees = [{ id: 'COO', name: '피터', department: '대표이사실', position: '대표이사', instruction: '' }];
  const oversizedTaskId = await call({ task: '테스트 업무', taskId: 't'.repeat(129), employees: validEmployees }, { db: null });
  assert.equal(oversizedTaskId.status, 400);
  assert.match(oversizedTaskId.body.error, /128자/);

  const nonStringIdempotencyKey = await call({ task: '테스트 업무', idempotencyKey: { key: 'x' }, employees: validEmployees }, { db: null });
  assert.equal(nonStringIdempotencyKey.status, 400);
  assert.match(nonStringIdempotencyKey.body.error, /idempotencyKey/);

  const oversizedInstruction = await call({
    task: '테스트 업무',
    employees: [{ ...validEmployees[0], instruction: '지'.repeat(10001) }]
  }, { db: null });
  assert.equal(oversizedInstruction.status, 400);
  assert.match(oversizedInstruction.body.error, /instruction/);

  const missingEmployeeId = await call({
    task: '테스트 업무',
    employees: [{ ...validEmployees[0], id: '' }]
  }, { db: null });
  assert.equal(missingEmployeeId.status, 400);
  assert.match(missingEmployeeId.body.error, /직원 ID/);
});

test('blocks representative approval for PARTIAL_COMPLETED even if the review flag is true', async () => {
  const result = await call(
    { action: 'representative_decision', taskId: 'test-task-001', decision: 'APPROVE' },
    { db: new FakeD1({ status: 'PARTIAL_COMPLETED', releaseAllowed: true }) }
  );
  assert.equal(result.status, 409);
  assert.equal(result.db.events.length, 0);
  assert.equal(result.body.taskStatus, 'PARTIAL_COMPLETED');
});
