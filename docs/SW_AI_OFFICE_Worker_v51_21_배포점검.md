# SW AI OFFICE Worker v51.26 배포 점검

## 배포 후보

- 저장소: creditor5120-sketch/ai-office
- 개발 브랜치: work/office3d-integration
- 검토 PR: https://github.com/creditor5120-sketch/ai-office/pull/4
- Worker 파일: worker/SW_AI_OFFICE_Worker_v51_22_completion_audit.js
- 파일명 표기: v51.22 completion audit
- 코드 내부 실행 버전: v51.26
- 운영 Worker URL: https://ai-office-api.creditor5120.workers.dev/

**현재 상태: 배포 후보이며 운영 반영 여부는 확인되지 않았다.** PR #4는 초안이고 main에 병합되지 않았다. 이 문서는 운영 Worker가 v51.26으로 배포되었다는 의미가 아니다.

## 기존 설정 유지

Cloudflare Worker의 기존 설정을 삭제하거나 이름을 바꾸지 않는다.

- D1 바인딩: DB
- Secret: OFFICE_ACCESS_TOKEN
- Secret: OPENROUTER_API_KEY

## 추가 Secret

- 이름: REPRESENTATIVE_ACCESS_TOKEN
- 용도: 대표 승인·반려 전용 인증
- OFFICE_ACCESS_TOKEN과 반드시 다른 값으로 설정한다.
- 실제 비밀값은 GitHub 저장소, 소스 코드, 업무 지시문, 대화창에 입력하지 않는다.

## 배포 전 필수 확인

1. Cloudflare에서 현재 운영 Worker 코드와 설정을 확인한다.
2. 기존 D1 데이터베이스와 바인딩 이름 DB를 확인한다.
3. [D1 스키마 읽기 전용 점검표](./SW_AI_OFFICE_D1_SCHEMA_AUDIT.md)에 따라 tasks, task_events, task_checkpoints의 실제 테이블·컬럼·인덱스·외래 키를 확인한다.
4. 기존 운영 스키마와 Worker가 사용하는 SQL의 호환성을 확인한다.
5. OFFICE_ACCESS_TOKEN과 OPENROUTER_API_KEY가 기존과 동일하게 유지되는지 확인한다.
6. REPRESENTATIVE_ACCESS_TOKEN이 설정되어 있는지 확인한다. 일반 업무 API 토큰과 다른 값이어야 한다.
7. 운영 DB 백업 및 복구 가능성을 확인한다.
8. 위 확인이 끝나기 전에는 운영 Worker 코드 교체나 D1 스키마 변경을 하지 않는다.

## 배포 후 확인

1. 일반 업무 요청이 기존 OFFICE_ACCESS_TOKEN으로 인증되는지 확인한다.
2. 업무 이력 조회(get_task_history)가 정상 응답하는지 확인한다.
3. 대표 승인 요청은 대표 전용 토큰이 없거나 틀리면 401로 거부되는지 확인한다.
4. 대표 전용 토큰이 유효하면 승인·반려가 D1에 기록되는지 확인한다.
5. 최종 검수 게이트를 통과하지 않은 업무의 승인이 서버에서 409로 거부되는지 확인한다.
6. 같은 결정의 재요청은 중복 기록되지 않고, 반대 결정으로 기존 결정이 덮어써지지 않는지 확인한다.
7. 업무 재개·완료·실패 시 상태와 감사 이벤트가 함께 기록되는지 확인한다.

## 검증 범위의 한계

- GitHub Actions의 Worker 계약 테스트는 격리된 모의 D1을 사용한다. 운영 D1의 실제 스키마나 제약조건을 검증한 결과가 아니다.
- 실제 Cloudflare 운영 Worker의 Secret·D1을 사용한 실서비스 통합 테스트는 별도로 수행해야 한다.
- 대표 전용 토큰은 별도 접근 통제 수단이며, 개인별 계정 로그인이나 실명 신원 확인을 대체하지 않는다.
- 외부 발송·계약 체결 등 실제 외부 실행은 자동 수행하지 않는다.
