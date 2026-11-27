# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office initialization and staff card rendering logic to ensure the representative CEO and COO are correctly identified and routed.

## 판단 근거

The previous implementation had a potential mismatch in the staff card rendering logic where the CEO and COO roles were not consistently mapped to the expected '단테' and '알렉스' display names, which could cause the routing contract to fail in the 3D office. This patch ensures the `makeStaffCard` function and the avatar initialization logic correctly use the `characterNames` mapping and the agreed-upon ID-to-name contract.

