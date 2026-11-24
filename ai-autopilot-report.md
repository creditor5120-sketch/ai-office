# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and detail view synchronization.

## 판단 근거

The 3D office staff cards and detail view were not correctly reflecting the active status of the staff members due to a missing call to refresh the staff cards after the initial setup. This patch ensures that the staff cards and detail view are correctly populated and synchronized with the employee states upon initialization.

