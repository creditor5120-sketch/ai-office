-- SW AI OFFICE v3.15 D1 read-only schema preflight
-- Run in the Cloudflare D1 console against the existing database.
-- All statements below are read-only. Do not run schema changes as part of preflight.
-- IMPORTANT: Run section 1 first. If any required table is absent, stop and do not run sections 2-6.

-- 1) Confirm the three workflow tables exist and inspect their CREATE statements.
SELECT type, name, sql
FROM sqlite_master
WHERE type IN ('table', 'index')
  AND name IN ('tasks', 'task_events', 'task_checkpoints')
ORDER BY type, name;

-- 2) Inspect actual columns. Compare with the required column list in the deployment guide.
PRAGMA table_info('tasks');
PRAGMA table_info('task_events');
PRAGMA table_info('task_checkpoints');

-- 2-1) Machine-readable missing-column check.
-- An empty result means all Worker-required columns exist.
WITH required(table_name, column_name) AS (
  VALUES
    ('tasks', 'task_id'),
    ('tasks', 'idempotency_key'),
    ('tasks', 'task'),
    ('tasks', 'status'),
    ('tasks', 'current_stage'),
    ('tasks', 'input_json'),
    ('tasks', 'partial_result_json'),
    ('tasks', 'error_message'),
    ('tasks', 'attempt_count'),
    ('tasks', 'created_at'),
    ('tasks', 'updated_at'),
    ('tasks', 'started_at'),
    ('tasks', 'completed_at'),
    ('tasks', 'control_request'),
    ('tasks', 'lock_token'),
    ('tasks', 'lease_expires_at'),
    ('tasks', 'execution_version'),
    ('tasks', 'checkpoint_stage'),
    ('tasks', 'checkpoint_json'),
    ('task_events', 'event_id'),
    ('task_events', 'task_id'),
    ('task_events', 'event_type'),
    ('task_events', 'actor'),
    ('task_events', 'stage'),
    ('task_events', 'detail_json'),
    ('task_events', 'created_at'),
    ('task_checkpoints', 'checkpoint_id'),
    ('task_checkpoints', 'task_id'),
    ('task_checkpoints', 'stage_key'),
    ('task_checkpoints', 'stage_name'),
    ('task_checkpoints', 'checkpoint_json'),
    ('task_checkpoints', 'created_at')
),
actual(table_name, column_name) AS (
  SELECT 'tasks', name FROM pragma_table_info('tasks')
  UNION ALL
  SELECT 'task_events', name FROM pragma_table_info('task_events')
  UNION ALL
  SELECT 'task_checkpoints', name FROM pragma_table_info('task_checkpoints')
)
SELECT required.table_name, required.column_name AS missing_column
FROM required
LEFT JOIN actual
  ON actual.table_name = required.table_name
 AND actual.column_name = required.column_name
WHERE actual.column_name IS NULL
ORDER BY required.table_name, required.column_name;

-- 3) Inspect uniqueness, indexed columns, and index definitions used for
-- idempotency (tasks.idempotency_key) and checkpoint replay
-- (task_checkpoints.task_id + task_checkpoints.stage_key).
PRAGMA index_list('tasks');
PRAGMA index_list('task_events');
PRAGMA index_list('task_checkpoints');

SELECT
  sm.name AS table_name,
  il.name AS index_name,
  il."unique" AS is_unique,
  ii.seqno AS column_order,
  ii.name AS column_name
FROM sqlite_master AS sm
JOIN pragma_index_list(sm.name) AS il
JOIN pragma_index_info(il.name) AS ii
WHERE sm.type = 'table'
  AND sm.name IN ('tasks', 'task_events', 'task_checkpoints')
ORDER BY sm.name, il.name, ii.seqno;

-- 4) Database integrity and declared foreign-key consistency.
PRAGMA integrity_check;
PRAGMA foreign_key_check;

-- 5) Check logical parent/child associations even if foreign keys were not declared.
SELECT 'task_events_without_task' AS check_name, COUNT(*) AS row_count
FROM task_events e
LEFT JOIN tasks t ON t.task_id = e.task_id
WHERE t.task_id IS NULL
UNION ALL
SELECT 'task_checkpoints_without_task', COUNT(*)
FROM task_checkpoints c
LEFT JOIN tasks t ON t.task_id = c.task_id
WHERE t.task_id IS NULL;

-- 6) Inspect row counts and task status totals without exposing task text,
-- reports, tokens, or personal data.
SELECT 'tasks' AS table_name, COUNT(*) AS row_count FROM tasks
UNION ALL
SELECT 'task_events', COUNT(*) FROM task_events
UNION ALL
SELECT 'task_checkpoints', COUNT(*) FROM task_checkpoints;

SELECT status, COUNT(*) AS row_count
FROM tasks
GROUP BY status
ORDER BY status;
