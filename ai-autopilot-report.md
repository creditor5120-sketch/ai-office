# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering logic to correctly map character names and departments.

## 판단 근거

The 3D office was displaying placeholder names and departments for non-CEO staff because the `characterNames` mapping and department logic were not correctly applied to the staff cards in the `staffStrip` and `detailEmployeeList`. This patch ensures that the `characterNames` mapping is used consistently for display and that the department is correctly retrieved from the employee directory.

