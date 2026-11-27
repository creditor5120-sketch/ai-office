# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'office-map.html' navigation link in 'office3d.html' and ensure the 2D/3D toggle correctly updates the UI state.

## 판단 근거

The smoke test identified that the 2D/3D toggle and navigation between the 3D office and the 2D map were not fully synchronized or correctly implemented in the provided source. The patch ensures the navigation link is present and the toggle logic correctly updates the visibility of 3D elements and the UI state.

