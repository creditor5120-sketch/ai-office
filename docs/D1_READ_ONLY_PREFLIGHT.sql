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
