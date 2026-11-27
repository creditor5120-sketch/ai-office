# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'officeAudit' function in the 3D office environment to ensure the smoke test correctly validates the office state.

## 판단 근거

The smoke test relies on `window.__officeFloorAudit` to verify the office structure (desk count, team count, etc.). While the function was defined in the script, it was not correctly exposed to the window object in a way that the test could reliably access it during the initialization phase. This patch ensures the function is properly attached to the window object.

