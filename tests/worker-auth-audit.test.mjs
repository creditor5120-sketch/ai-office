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
          const event = db.events.find(x => x.task_id === args[0]);
          return event ? { detail_json: event.detail_json, created_at: event.created_at } : null;
        }
        return null;
      },
      async all() {
        if (sql.includes('FROM task_events')) return { results: db.events.map(x => ({ ...x })) };
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
