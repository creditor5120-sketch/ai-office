# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office initialization error by ensuring the loading panel is correctly hidden after the scene is mounted.

## 판단 근거

The loading panel was not being hidden in the final step of the 3D office initialization, causing the UI to remain stuck in a loading state even after the scene was successfully mounted. This patch ensures the loading element is hidden after the renderer is appended to the DOM.

