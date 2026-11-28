# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and detail view synchronization.

## 판단 근거

The 3D office staff cards and detail view were not correctly reflecting the active employee state when toggling between views or selecting employees, leading to potential UI desynchronization. This patch ensures that the staff card and detail view lists are correctly populated and synchronized with the avatar state upon initialization and view toggles.

