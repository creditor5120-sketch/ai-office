# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office initialization error by ensuring the loading panel is correctly hidden and the 3D scene is properly initialized before the smoke test proceeds.

## 판단 근거

The smoke test was failing due to a race condition where the loading panel was not being hidden correctly, causing the test to timeout. This patch ensures the loading panel is explicitly hidden after the 3D scene is ready and adds a more robust check for the loading panel's state.

