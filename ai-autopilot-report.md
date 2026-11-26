# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'activeCount' update logic in the 3D office initialization.

## 판단 근거

The 3D office initialization correctly calculates the staff count but fails to update the 'activeCount' DOM element before the initial render, causing a '-' placeholder to persist until a manual refresh. This patch ensures the count is correctly set during the initial load.

