# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the regression in the 3D office initialization where the loading panel was not correctly hidden when the 3D scene was ready, and ensure the office audit function is correctly exposed.

## 판단 근거

The smoke test failed because the loading panel remained visible due to a race condition in the initialization sequence. By ensuring the loading panel is explicitly hidden after the 3D scene is mounted and the audit function is attached, we ensure a reliable UI state. The audit function is also explicitly attached to the window object to satisfy the smoke test requirements.

