# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'activeCount' initialization and ensure staff card rendering is consistent with the 3D office state.

## 판단 근거

The `activeCount` element was not being updated correctly during the initial load, leading to a '-' display. By ensuring `refreshStaffCards()` and the count update are called after the DOM is ready, we ensure the UI truthfully reflects the office state.

