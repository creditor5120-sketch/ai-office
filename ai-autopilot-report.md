# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Implement the representative-to-Alex routing contract and verify it with a regression test.

## 판단 근거

The routing contract requires that selecting the CEO (단테) in the 3D office must route the task to the COO (알렉스). This patch updates the `submitSelectedTask` function in `office3d.html` to correctly identify the COO when the CEO is selected, ensuring the payload reflects the correct employee ID and name. A regression test is included in `tests/office3d-smoke.mjs` to enforce this routing behavior.

