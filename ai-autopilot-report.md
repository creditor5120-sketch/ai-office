# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Add a regression test for the idempotent task resumption path to ensure the workflow bridge correctly reuses existing task IDs and idempotency keys.

## 판단 근거

The current smoke test verifies the happy path and basic resumption, but explicitly testing the idempotency key reuse and task ID preservation in the workflow bridge ensures that interrupted tasks do not trigger duplicate AI calls upon resumption, which is critical for the idempotent retry requirement.

