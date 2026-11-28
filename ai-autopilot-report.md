# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Implement the representative-to-Alex routing contract and verify it with a regression test.

## 판단 근거

The routing contract requires that selecting the CEO (단테) in the 3D office must route the task to the COO (알렉스). The current implementation was missing the explicit routing logic in the `submitSelectedTask` function. This patch ensures that if the selected employee is the CEO, the task is routed to the COO, and the employee display name is set to '알렉스'. A regression test is included to verify this behavior.

