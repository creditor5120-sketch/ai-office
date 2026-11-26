# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and detail view employee list to correctly reflect the characterNames mapping.

## 판단 근거

The 3D office source code was using the `characterNames` mapping for the `staffStrip` and `detailEmployeeList` but the `makeStaffCard` function was not consistently applying this mapping to the `b` element (name display) inside the staff card, leading to potential mismatches between the 3D avatar label and the UI card name. This patch ensures the `characterNames` mapping is used for the display name in the staff cards.

