# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the routing contract regression in the 3D office and ensure the representative CEO selection correctly routes to COO 알렉스.

## 판단 근거

The routing contract requires that selecting the CEO in the 3D office must route to the COO (알렉스). The current implementation in `office3d.html` had a potential mismatch in the `selectAvatar` logic and the `submitSelectedTask` routing logic. This patch ensures that the `selectAvatar` and `submitSelectedTask` functions consistently treat the CEO as the COO for routing purposes, maintaining the contract verified by the smoke test.

