# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card and detail view employee selection logic to ensure the representative CEO (단테) and COO (알렉스) are correctly identified and routed.

## 판단 근거

The current implementation in office3d.html had a minor inconsistency in the `makeStaffCard` and `selectAvatar` functions where the display name and ID mapping for the CEO and COO were not fully unified, potentially causing issues with the routing contract. This patch ensures that the CEO is consistently identified as '단테' and the COO as '알렉스' across all UI components, maintaining the agreed-upon routing contract.

