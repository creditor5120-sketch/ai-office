# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing `officeAudit` function in `office3d.html` to ensure the 3D office smoke test passes.

## 판단 근거

The smoke test `tests/office3d-smoke.mjs` expects a global `window.__officeFloorAudit` function to be defined in `office3d.html` to verify the office state. This function was missing from the provided `office3d.html` source, causing the test to fail. Adding it ensures the test can correctly audit the office configuration.

