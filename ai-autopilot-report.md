# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and selection logic to ensure the representative CEO (단테) and COO (알렉스) are correctly identified and routed.

## 판단 근거

The previous implementation had a potential mismatch in the staff card rendering and selection logic for the CEO and COO roles. By ensuring the `avatars` array and `staff` array are correctly synchronized and the `selectAvatar` function correctly handles the CEO/COO routing contract, we ensure the 3D office UI remains consistent with the established routing rules.

