# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office avatar selection routing and ensure the representative CEO selection correctly routes to the COO (알렉스).

## 판단 근거

The routing contract requires that selecting the CEO (단테) in the 3D office must route the request to the COO (알렉스). The current implementation in `office3d.html` had a potential ambiguity in the `selectAvatar` and `submitSelectedTask` logic where the `selected` variable might not consistently reflect the routed employee ID for the CEO. This patch ensures that when the CEO is selected, the `selected` avatar's person object is explicitly treated as the COO for task submission, maintaining parity with the established routing contract and regression tests.

