import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../docs/D1_READ_ONLY_PREFLIGHT.sql', import.meta.url), 'utf8');
const executableSql = sql
  .replace(/--[^\n]*/g, '')
  .trim();

test('D1 preflight contains only read-only SQL statements', () => {
  const statements = executableSql.split(';').map(value => value.trim()).filter(Boolean);
  assert.ok(statements.length >= 10, 'expected the complete D1 preflight query set');
  for (const statement of statements) {
    assert.match(statement, /^(SELECT|PRAGMA|WITH)\b/i, 'non-read-only statement found: ' + statement.slice(0, 100));
    assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|ATTACH|DETACH|VACUUM)\b/i);
  }
});

test('D1 preflight checks all Worker tables, required columns, and unique replay constraints', () => {
  for (const table of ['tasks', 'task_events', 'task_checkpoints']) {
    assert.ok(executableSql.includes("'" + table + "'"), 'missing table check: ' + table);
  }
  for (const column of ['task_id', 'idempotency_key', 'current_stage', 'lock_token', 'lease_expires_at', 'checkpoint_json', 'detail_json', 'stage_key']) {
    assert.ok(executableSql.includes("'" + column + "'"), 'missing required column check: ' + column);
  }
  assert.match(executableSql, /PRAGMA\s+integrity_check/i);
  assert.match(executableSql, /PRAGMA\s+foreign_key_check/i);
  assert.match(executableSql, /is_unique\s*=\s*1/i);
  assert.match(executableSql, /is_partial\s*=\s*0/i);
});
