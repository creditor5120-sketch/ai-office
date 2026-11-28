# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office avatar selection and detail view synchronization.

## 판단 근거

The 3D office was not correctly synchronizing the active employee state between the 3D view and the detail view when toggling modes, leading to inconsistent UI states. This patch ensures that selecting an employee in the 3D view correctly updates the detail view and vice versa, maintaining parity with the established routing contract.

