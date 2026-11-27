# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and selection logic to ensure the CEO (단테) and COO (알렉스) are correctly identified and routed.

## 판단 근거

The previous implementation had a potential mismatch in the staff card rendering logic where the CEO and COO might not have been correctly mapped to their respective IDs and display names, which is critical for the routing contract. This patch ensures the `staffCard` generation and `selectAvatar` logic correctly handle the CEO and COO roles, maintaining parity with the established routing contract.

