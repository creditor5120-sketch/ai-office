# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering logic to correctly map character names and departments.

## 판단 근거

The current implementation in `office3d.html` has a mismatch between the `characterNames` mapping and the `directory` data, leading to incorrect display names for staff members. This patch ensures that the `characterNames` mapping is correctly applied during the staff card generation process, ensuring parity between the 3D office UI and the employee directory.

