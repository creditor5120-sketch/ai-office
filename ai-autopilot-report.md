# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'officeAudit' function in the 3D office environment to ensure the smoke test correctly validates the office state.

## 판단 근거

The smoke test expects `window.__officeFloorAudit` to be defined to verify the office structure (desk count, floor count, etc.). While the function was defined in the script, it was missing from the `window` object scope in the provided `office3d.html` source. This patch ensures the audit function is correctly attached to `window`.

