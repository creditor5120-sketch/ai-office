# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office regression test to correctly identify the single-floor structure.

## 판단 근거

The smoke test was failing because it expected a floor selector that no longer exists in the single-floor 3D office design. The patch removes the incorrect check for floor selector buttons and ensures the audit function is correctly called.

