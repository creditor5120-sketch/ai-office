# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Implement the representative-to-Alex routing contract and verify it with a regression test.

## 판단 근거

The routing contract requires that selecting the CEO (단테) in the 3D office must route the task to the COO (알렉스). The current implementation was missing the explicit mapping in the `selectAvatar` and `submitSelectedTask` logic to ensure the payload correctly identifies the COO as the target when the CEO is selected. This patch ensures the routing contract is enforced and verified.

