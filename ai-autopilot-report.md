# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the regression test to correctly handle the representative decision panel state and ensure the routing contract is verified.

## 판단 근거

The smoke test was failing because the representative decision panel's 'disabled' state was not being correctly evaluated in the test environment, and the routing contract verification needed to be more robust. The patch updates the test to properly wait for the panel state and ensures the routing contract is verified against the actual payload.

