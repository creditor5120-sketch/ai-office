# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the regression test to correctly handle the representative decision panel's state and ensure the routing contract is verified.

## 판단 근거

The smoke test was failing because it expected the representative decision panel to be enabled immediately after selecting a task, but the panel logic requires both a task selection and a specific state (not yet decided) to enable the approval button. The patch updates the test to correctly wait for the panel to be enabled and ensures the routing contract is strictly verified.

