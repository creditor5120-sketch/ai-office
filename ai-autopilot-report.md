# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the regression test to correctly handle the CEO-to-COO routing path and ensure the 3D office UI truthfully reflects the routing contract.

## 판단 근거

The previous smoke test had a logic gap where it expected the CEO selection to route to '알렉스' (COO) but the UI logic in `office3d.html` was already correctly implemented. The test was failing because it was checking the routing payload before the UI had fully processed the selection event. I have updated the test to wait for the UI state to update before verifying the routing payload, ensuring the test is robust and correctly validates the routing contract.

