# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card data binding and ensure the representative CEO routing contract is strictly maintained.

## 판단 근거

The 3D office staff card rendering logic had a minor inconsistency in mapping the CEO role to the '단테' display name, which could lead to UI/logic mismatches. This patch ensures the `characterNames` mapping is consistently applied during staff card generation and detail view rendering, reinforcing the routing contract verified by the regression tests.

