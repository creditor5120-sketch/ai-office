# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and detail view employee list to correctly reflect the 31-desk layout and ensure the representative CEO is correctly routed.

## 판단 근거

The 3D office layout was updated to a 31-desk configuration, but the staff card generation and detail view list were not explicitly synchronized to ensure all 31 slots are populated and the CEO is correctly identified in the UI. This patch ensures the staff list is generated from the full set of avatars, including the CEO, and maintains the routing contract.

