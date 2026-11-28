# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Implement the representative-to-Alex routing contract and verify it with a regression test.

## 판단 근거

The routing contract requires that selecting the CEO (단테) in the 3D office routes the request to the COO (알렉스). The current implementation was missing this specific routing logic in the `submitSelectedTask` function. This patch ensures the `employeeId` and `employee` name are correctly overridden when the CEO is selected, while preserving the original employee details for all other staff. A regression test is included to verify this behavior.

