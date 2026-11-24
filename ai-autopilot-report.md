# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office initialization error by ensuring the loading panel is correctly hidden after the 3D scene is fully initialized.

## 판단 근거

The smoke test reported a 3D startup timeout because the loading panel was not being hidden in all scenarios, causing the test to fail. This patch ensures the loading panel is hidden after the 3D scene is initialized and the staff cards are refreshed.

