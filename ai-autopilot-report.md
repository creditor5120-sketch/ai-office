# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card data binding and ensure the representative CEO routing contract is correctly applied to the staff list.

## 판단 근거

The 3D office staff card generation logic was using the raw directory data instead of the mapped display names (e.g., '알렉스' for 'COO'). This caused a mismatch between the 3D UI and the routing contract verified by the smoke tests. The patch ensures the staff card generation uses the `characterNames` mapping, maintaining parity with the 3D avatar initialization.

