-- SW AI OFFICE v3.15 D1 read-only schema preflight
-- Run in the Cloudflare D1 console against the existing database.
-- These statements are read-only. Do not run schema changes as part of preflight.

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

-- 3) Inspect uniqueness and index definitions used for idempotency/checkpoint replay.
PRAGMA index_list('tasks');
PRAGMA index_list('task_events');
PRAGMA index_list('task_checkpoints');

-- 4) Inspect row counts without exposing task text, reports, tokens, or personal data.
SELECT 'tasks' AS table_name, COUNT(*) AS row_count FROM tasks
UNION ALL
SELECT 'task_events', COUNT(*) FROM task_events
UNION ALL
SELECT 'task_checkpoints', COUNT(*) FROM task_checkpoints;

-- 5) Inspect task status totals only.
SELECT status, COUNT(*) AS row_count
FROM tasks
GROUP BY status
ORDER BY status;
