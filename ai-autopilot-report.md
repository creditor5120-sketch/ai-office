# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'selectedCount' element reference in the 3D office UI.

## 판단 근거

The `selectAvatar` function attempts to update `document.getElementById('selectedCount')`, but this element is missing from the `office3d.html` DOM, causing a potential runtime error when selecting an employee. Adding this element ensures the UI remains stable and consistent with the existing logic.

