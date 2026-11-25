# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and selection logic to ensure the CEO (단테) and COO (알렉스) are correctly identified and routed.

## 판단 근거

The current implementation of `office3d.html` has a potential mismatch in the `staff` array initialization and the `characterNames` mapping. By ensuring the `staff` array is correctly constructed with the CEO and COO roles, and that the `characterNames` mapping is applied consistently during avatar creation, we ensure the routing contract (CEO -> COO) is robustly supported. The patch ensures the `staff` array is correctly initialized and the `characterNames` are applied to all directory members.

