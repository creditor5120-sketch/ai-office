# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering and detail view synchronization.

## 판단 근거

The staff card rendering logic in `office3d.html` was missing the `department` property mapping for the detail view, causing inconsistencies between the 3D office and the detail view. This patch ensures the `department` and `jobTitle` are correctly mapped and displayed, maintaining parity with the 3D office's staff list.

