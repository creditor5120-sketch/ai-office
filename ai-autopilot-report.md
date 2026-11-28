# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Implement the representative-to-Alex routing contract and verify it with a regression test.

## 판단 근거

The routing contract requires that selecting the CEO (단테) in the 3D office must route the task to the COO (알렉스). The current implementation was missing the explicit routing logic in `office3d.html` to map the CEO ID to the COO ID and name before the payload is sent to the workflow bridge. This patch ensures the payload correctly identifies the employee as 알렉스 (COO) when the CEO is selected, maintaining consistency with the agreed-upon routing contract.

