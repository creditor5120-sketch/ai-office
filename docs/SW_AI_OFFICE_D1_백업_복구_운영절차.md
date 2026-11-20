# SW AI OFFICE D1 백업·복구 운영 절차

## 1. 목적과 적용 범위

이 문서는 SW AI OFFICE 업무 데이터가 저장되는 Cloudflare D1 데이터베이스의 백업, 복구, 복구 검증 절차를 정한다.

대상 테이블:
- `tasks`: 업무 접수·진행·완료 상태와 저장된 결과
- `task_events`: 지시·배정·실행·검수·수정·대표 결정 감사 이력
- `task_checkpoints`: AI 실행 재개용 체크포인트

현재 저장소에서 확인한 D1 바인딩 이름은 `DB`, 문서상 데이터베이스 이름은 `sw-ai-office-db`다. 실제 운영 계정·데이터베이스·스토리지 버전은 Cloudflare에서 별도 확인해야 한다.

## 2. 백업 체계 구분

### 2-1. Cloudflare D1 Time Travel

Cloudflare 공식 문서 기준으로 D1의 `version: production` 스토리지 데이터베이스는 Time Travel을 지원한다. Time Travel은 별도 활성화 없이 자동으로 시점 복구 지점을 관리한다.

- Workers Free: 최근 7일 범위
- Workers Paid: 최근 30일 범위
- 적용 여부는 요금제와 실제 DB의 `version`을 확인한 뒤 확정한다.
- `version: alpha` 데이터베이스는 구형 스냅샷 백업 방식을 사용하므로 Time Travel 적용 대상으로 간주하지 않는다.

확인 명령:

```bash
npx wrangler d1 info sw-ai-office-db
```

출력의 `version` 값을 확인하고 기록한다. Time Travel 사용 가능 여부를 추측하지 않는다.

### 2-2. 장기 보관용 별도 백업

Time Travel은 시점 복구 수단이며, 장기 보관용 독립 백업을 대신하지 않는다. 30일을 초과하는 보관이 필요하면 D1 Export 작업을 Cloudflare Workflows로 정기 실행하고, 생성된 SQL 덤프를 별도 R2 버킷에 저장하는 구성을 사용한다.

권장 초안(운영 승인 전 제안):
- 백업 주기: 매일 1회
- 보관: 일별 백업 90일
- 파일명: 데이터베이스명 + UTC 생성시각 + Export 작업 식별자
- 백업 완료 여부, 파일 크기, 생성 시각, Export 오류를 로그로 남긴다.
- 백업 파일과 R2 접근 권한은 운영 DB 권한과 분리한다.
- 실제 R2 버킷, Workflows, 스케줄, 보관 정책은 계정 설정 확인 및 별도 구현이 필요하다. 현재 구성되어 있다고 간주하지 않는다.

## 3. 백업 실행 및 확인

### 3-1. 정기 백업

1. D1의 실제 스토리지 버전과 Time Travel 복구 가능 기간을 확인한다.
2. 장기 보관용 R2 Export Workflow가 구성된 경우 매일 스케줄이 실행되는지 확인한다.
3. 각 실행의 Export 성공, R2 저장 성공, 파일 크기(0보다 큰지), 완료 시각을 기록한다.
4. 실패 시 오류를 기록하고 재시도한다. 실패한 실행을 성공으로 표시하지 않는다.
5. 백업 결과 목록과 최근 성공 시각을 운영 점검 기록에 남긴다.

### 3-2. 수동 백업

스키마 변경, 대량 데이터 수정·삭제 등 위험 작업 전에는 작업 전 백업을 별도로 확보한다. D1의 현재 스토리지 버전이 지원하는 백업·Export 방법을 확인한 뒤 실행한다.

운영 변경 전 확인 사항:
- 대상 계정과 데이터베이스가 맞는지
- 백업 완료 상태인지
- 백업 파일을 내려받을 수 있는지
- 백업 파일 크기와 생성 시각이 기록됐는지

## 4. 복구 절차

### 4-1. 복구 전 필수 조치

1. 장애 발생 시각, 영향 범위, 마지막 정상 시각을 기록한다.
2. 복구 대상 DB와 복구 기준 시각을 확인한다.
3. 복구 전에 현재 운영 DB의 별도 백업 또는 현재 Time Travel bookmark를 확보한다.
4. 진행 중인 업무 요청을 중단하거나 운영 담당자와 통제한다.
5. 복구 승인을 받는다.

### 4-2. Time Travel 복구

Time Travel 복구는 기존 데이터베이스를 해당 시점으로 덮어쓰는 파괴적 작업이다. 운영 DB에서 시험 목적으로 실행하지 않는다.

복구 지점 확인:

```bash
npx wrangler d1 time-travel info sw-ai-office-db
npx wrangler d1 time-travel info sw-ai-office-db --timestamp="2026-11-21T00:00:00Z"
```

복구 명령은 운영 DB를 덮어쓰므로 별도 승인과 사전 백업 없이는 실행하지 않는다.

```bash
npx wrangler d1 time-travel restore sw-ai-office-db --bookmark="<승인된_BOOKMARK>"
```

복구 명령이 반환하는 이전 bookmark는 반드시 보관한다. 잘못된 복구를 되돌릴 때 사용할 수 있다.

### 4-3. 별도 검증 DB 복원

복구 검증은 운영 DB가 아닌 별도 검증용 D1에서 실시한다.

- Time Travel 복구 기능을 운영 DB에서 시험하지 않는다.
- 장기 백업 SQL 덤프를 별도 검증용 D1에 가져오거나, 지원되는 별도 복원 절차를 사용한다.
- 운영 데이터베이스 이름과 검증용 데이터베이스 이름을 혼동하지 않도록 명확히 구분한다.
- 검증용 DB를 운영 Worker의 `DB` 바인딩에 연결하지 않는다.

## 5. 복구 검증 체크리스트

복원한 검증용 DB에서 다음 항목을 모두 확인한다.

### 5-1. SQLite 무결성

```sql
PRAGMA integrity_check;
PRAGMA foreign_key_check;
```

- `integrity_check` 결과가 `ok`인지 확인한다.
- `foreign_key_check` 결과가 비어 있는지 확인한다.

### 5-2. 테이블별 건수

```sql
SELECT 'tasks' AS table_name, COUNT(*) AS row_count FROM tasks
UNION ALL
SELECT 'task_events', COUNT(*) FROM task_events
UNION ALL
SELECT 'task_checkpoints', COUNT(*) FROM task_checkpoints;

SELECT status, COUNT(*) AS row_count
FROM tasks
GROUP BY status
ORDER BY status;
```

백업 원본 시점의 기록된 건수와 비교한다. 복구 시점 이후 생성된 업무가 없는 것은 정상일 수 있으므로 기준 시각을 함께 비교한다.

### 5-3. 고아 데이터 확인

```sql
SELECT 'task_events_without_task' AS check_name, COUNT(*) AS row_count
FROM task_events e
LEFT JOIN tasks t ON t.task_id = e.task_id
WHERE t.task_id IS NULL
UNION ALL
SELECT 'task_checkpoints_without_task', COUNT(*)
FROM task_checkpoints c
LEFT JOIN tasks t ON t.task_id = c.task_id
WHERE t.task_id IS NULL;
```

두 결과의 건수가 모두 0인지 확인한다.

### 5-4. 필수 스키마와 제약조건

저장소의 `docs/D1_READ_ONLY_PREFLIGHT.sql` 전체를 검증용 DB에서 실행한다.

- 필수 테이블과 컬럼 누락이 없어야 한다.
- `tasks.idempotency_key` 단일 UNIQUE 인덱스가 있어야 한다.
- `task_checkpoints(task_id, stage_key)` 복합 UNIQUE 인덱스가 있어야 한다.
- 인덱스 컬럼 순서와 부분 인덱스 여부까지 검사한다.

### 5-5. 애플리케이션 수준 확인

검증용 환경에서만 수행한다.
- 업무 목록 조회가 가능해야 한다.
- 기존 업무의 감사 이력과 체크포인트가 해당 업무 ID에 연결되어야 한다.
- 저장된 결과 JSON을 해석할 수 있어야 한다.
- 테스트 업무를 별도로 생성·실행·완료하고 이력 조회가 가능해야 한다.
- 검수 미통과 업무의 대표 승인이 거부되어야 한다.
- 검증 완료 후 검증용 DB와 운영 DB가 서로 연결되지 않았는지 재확인한다.

## 6. 복구 완료 판정과 기록

다음 조건을 모두 충족해야 복구 검증 완료로 판정한다.

- [ ] 복구 원본과 기준 시각 기록
- [ ] SQLite 무결성 검사 통과
- [ ] 테이블별 행 수와 업무 상태 건수 대조
- [ ] 고아 이벤트·체크포인트 0건
- [ ] 필수 컬럼·UNIQUE 제약조건 검사 통과
- [ ] 업무 목록·결과·감사 이력 조회 통과
- [ ] 테스트 업무 실행과 승인 게이트 확인 통과
- [ ] 복구 소요 시간과 누락 데이터 범위 기록
- [ ] 검증 담당자와 검증 일시 기록

복구 검증이 끝나도 운영 DB를 자동으로 교체하거나 운영 Worker를 변경하지 않는다. 운영 전환은 별도 승인 후 수행한다.

## 7. 현재 구현 상태와 미완료 항목

현재 저장소에서 확인되는 것은 업무 데이터를 D1에 저장하고 조회하는 Worker, 읽기 전용 스키마 사전 점검 SQL, 그리고 백업·복구 검증 절차 문서다.

아직 확인되지 않았거나 구현되지 않은 항목:
- 실제 운영 D1의 `version`과 Time Travel 지원 여부
- 실제 운영 계정의 Time Travel 복구 기간
- 장기 보관용 R2 버킷과 정기 Export Workflow
- 정기 백업 성공·실패 모니터링과 알림
- 별도 검증용 D1에 대한 실제 복원 테스트
- 실제 운영 데이터의 복구 가능성 입증

따라서 문서 작성과 CI 통과만으로 백업·복구 기능이 운영 중이라고 판정하지 않는다.

## 8. 공식 참고자료

- Cloudflare D1 Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
- Cloudflare D1 Export to R2 using Workflows: https://developers.cloudflare.com/workflows/examples/backup-d1/
- Cloudflare D1 legacy backups: https://developers.cloudflare.com/d1/reference/backups/
