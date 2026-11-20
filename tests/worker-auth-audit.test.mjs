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
      status,
      current_stage: '최종 보고',
      created_at: '2026-11-19T00:00:00.000Z',
      updated_at: '2026-11-19T00:01:00.000Z',
      completed_at: '2026-11-19T00:01:00.000Z',
      partial_result_json: JSON.stringify({ workflow: { resultStatus: '검수 완료', reviewGate: { finalReleaseAllowed: releaseAllowed } } })
    };
    this.events = [];
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
async function call(body, { access = ACCESS, representative = REPRESENTATIVE, db = new FakeD1() } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (access !== null) headers.Authorization = 'Bearer ' + access;
  if (representative !== null) headers['X-Representative-Authorization'] = 'Bearer ' + representative;
  const request = new Request('https://worker.test/', { method: 'POST', headers, body: JSON.stringify(body) });
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
