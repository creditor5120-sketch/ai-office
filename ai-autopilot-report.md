# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and detail view employee list to correctly reflect the characterNames mapping.

## 판단 근거

The 3D office source code was using the raw employee ID as the display name in the staff cards and detail view, rather than the mapped character names (e.g., 'MA-01' instead of '데니스'). This patch ensures the UI truthfully reflects the established character names for all employees, maintaining parity with the 2D map and the routing contract.

