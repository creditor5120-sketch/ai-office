# SW AI OFFICE D1 스키마 읽기 전용 점검표

## 목적과 범위

이 문서는 `worker/SW_AI_OFFICE_Worker_v51_22_completion_audit.js`가 사용하는 D1 테이블 구조가 실제 Cloudflare D1 데이터베이스와 일치하는지 확인하기 위한 **읽기 전용 점검 절차**다.

- 이 문서의 SQL은 조회만 수행한다. 테이블·컬럼·인덱스를 생성하거나 변경하지 않는다.
- 운영 D1에서 실행해도 데이터 행을 변경하지 않는다.
- 실제 운영 스키마는 이 저장소에서 확인되지 않았다. 아래 컬럼 목록은 현재 Worker SQL에서 확인되는 최소 요구 컬럼이며, 운영 DB에 이미 존재한다고 단정하지 않는다.
- Secret 값이나 API 토큰은 조회하거나 공유할 필요가 없다.

## 1. 테이블 존재 여부 및 생성 SQL 확인

Cloudflare Dashboard → Workers & Pages → D1 → 해당 DB → Console에서 실행한다.

```sql
SELECT type, name, tbl_name, sql
FROM sqlite_master
WHERE type IN ('table', 'index')
  AND tbl_name IN ('tasks', 'task_events', 'task_checkpoints')
ORDER BY tbl_name, type, name;
```

세 테이블의 생성 SQL과 인덱스 정의를 확인한다. `tasks`, `task_events`, `task_checkpoints`가 모두 있어야 한다.

## 2. 필수 컬럼 확인

각 문장을 개별 실행하고 결과를 보관한다.

```sql
PRAGMA table_info(tasks);
PRAGMA table_info(task_events);
PRAGMA table_info(task_checkpoints);
```

현재 Worker가 참조하는 최소 컬럼:

| 테이블 | 필수 컬럼 |
|---|---|
| `tasks` | `task_id`, `idempotency_key`, `task`, `status`, `current_stage`, `input_json`, `partial_result_json`, `error_message`, `attempt_count`, `created_at`, `updated_at`, `started_at`, `completed_at`, `control_request`, `lock_token`, `lease_expires_at`, `checkpoint_stage`, `checkpoint_json`, `execution_version` |
| `task_events` | `event_id`, `task_id`, `event_type`, `actor`, `stage`, `detail_json`, `created_at` |
| `task_checkpoints` | `checkpoint_id`, `task_id`, `stage_key`, `stage_name`, `checkpoint_json`, `created_at` |

컬럼 이름이 다르거나 빠진 경우 Worker를 배포하지 말고 먼저 기존 스키마와의 호환성을 검토한다. 기존 컬럼을 임의로 삭제·이름 변경하지 않는다.

## 3. 인덱스 및 키 제약 확인

```sql
PRAGMA index_list(tasks);
PRAGMA index_list(task_events);
PRAGMA index_list(task_checkpoints);
PRAGMA foreign_key_list(task_events);
PRAGMA foreign_key_list(task_checkpoints);
```

확인할 사항:

- `tasks.task_id`는 업무 조회·갱신의 기준 키로 유일해야 한다.
- `tasks.idempotency_key`는 재요청 시 동일 업무를 찾는 키이므로 유일 제약이 필요하다.
- `task_events.event_id`와 `task_checkpoints.checkpoint_id`는 각 레코드의 고유 식별자여야 한다.
- `task_events`와 `task_checkpoints`의 `task_id`가 `tasks.task_id`를 참조하는 외래 키인지 확인한다. 기존 데이터와 마이그레이션 정책을 확인하지 않은 채 외래 키를 추가하지 않는다.
- Worker는 `task_events` 및 `task_checkpoints` 조회에서 `rowid`를 사용한다. 해당 테이블이 `WITHOUT ROWID`로 생성되어 있으면 현재 SQL과 호환되지 않을 수 있다.

## 4. 데이터 무결성의 읽기 전용 확인

```sql
PRAGMA foreign_key_check;

SELECT 'tasks' AS table_name, COUNT(*) AS row_count FROM tasks
UNION ALL
SELECT 'task_events', COUNT(*) FROM task_events
UNION ALL
SELECT 'task_checkpoints', COUNT(*) FROM task_checkpoints;

SELECT task_id, COUNT(*) AS decision_count
FROM task_events
WHERE event_type = 'REPRESENTATIVE_DECISION'
GROUP BY task_id
HAVING COUNT(*) > 1;
```

마지막 조회 결과가 반환되면 동일 업무에 대표 결정 이벤트가 중복 저장된 것이다. 기존 기록을 임의 삭제하지 말고 원인과 보존 정책을 먼저 확인한다.

## 5. Worker 코드와 실제 운영 환경의 별도 확인 항목

스키마 조회만으로 다음 사항은 확인되지 않는다.

1. 운영 Worker가 이 저장소의 배포 후보 파일과 동일한 코드인지
2. D1 바인딩 이름이 `DB`인지
3. `OFFICE_ACCESS_TOKEN`, `REPRESENTATIVE_ACCESS_TOKEN`, `OPENROUTER_API_KEY` Secret이 운영 Worker에 설정되어 있는지
4. 운영 DB에 필요한 테이블·컬럼·제약·인덱스가 모두 적용되어 있는지
5. 실제 업무 생성·재개·완료·대표 결정이 운영 D1에 정상 기록되는지

Secret의 실제 값은 화면 캡처, 채팅, GitHub 파일에 남기지 않는다. 설정 여부만 Cloudflare Dashboard에서 직접 확인한다.

## 배포 판단

위 조회 결과를 확보하기 전에는 운영 Worker 교체 또는 D1 스키마 변경을 진행하지 않는다. 특히 운영 DB에 대한 `CREATE`, `ALTER`, `DROP`, `DELETE`, `UPDATE` 문은 이 점검 절차에서 실행하지 않는다.
