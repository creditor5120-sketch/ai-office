# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Add a regression test for the representative-to-COO routing contract and verify the 3D office UI state.

## 판단 근거

The routing contract between the CEO and COO is a critical requirement. The existing smoke test needs to be updated to explicitly verify that selecting the CEO in the 3D office correctly routes the payload to the COO (알렉스) and that the UI reflects this assignment, ensuring the routing contract is regression-tested.

