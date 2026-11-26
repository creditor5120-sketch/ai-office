# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering logic to correctly map character names and roles, ensuring the 3D office UI truthfully reflects the specialist assignment and team-lead review status as required by the acceptance flow.

## 판단 근거

The 3D office was displaying placeholder names ('직원') instead of the actual employee names mapped in the characterNames dictionary. This patch updates the `makeStaffCard` function to correctly resolve the display name and department/job title, ensuring the UI truthfully reflects the specialist assignment and team-lead review status.

