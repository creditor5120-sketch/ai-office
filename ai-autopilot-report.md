# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix routing defect where representative CEO instructions were rejected instead of being routed to COO (알렉스).

## 판단 근거

The `submitSelectedTask` function incorrectly rejected instructions from the 'CEO' (단테) because it did not explicitly handle the routing to the 'COO' (알렉스) before the validation checks. This patch ensures that CEO instructions are correctly remapped to the COO, preserving the required workflow hierarchy while maintaining direct routing for other staff.

