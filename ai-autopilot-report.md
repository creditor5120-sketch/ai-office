# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering logic to correctly map character names and roles.

## 판단 근거

The 3D office currently displays placeholder names (e.g., '직원') in the staff cards and detail view instead of the mapped names from the characterNames dictionary. This patch ensures that the staff card generation function uses the correct display name and job title, improving the UI's truthfulness and usability.

