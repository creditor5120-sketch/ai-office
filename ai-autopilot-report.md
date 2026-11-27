# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the regression test failure in `tests/office3d-smoke.mjs` by ensuring the modal is closed before selecting a new employee.

## 판단 근거

The smoke test was failing because it attempted to click a new employee card while the profile modal from the previous selection was still open, causing the click to be intercepted by the modal overlay. Adding a wait-and-close step ensures the UI is in the expected state for the next interaction.

