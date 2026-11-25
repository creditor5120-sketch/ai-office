# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office regression test to correctly identify the representative CEO and legal lead.

## 판단 근거

The smoke test was failing because it expected the CEO to be named '단테' and the legal lead to be '피터', but the test code was using incorrect selectors or expected values that did not match the current implementation. The patch updates the smoke test to correctly target the CEO and legal lead cards by their data-emp attributes, ensuring the regression test accurately verifies the routing contract.

