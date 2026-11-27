# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'office-map.html' navigation link to 'office3d.html' and ensure the 3D office entrypoint remains consistent.

## 판단 근거

The smoke test identified that 'office-map.html' was missing the navigation link back to 'office3d.html', which is required for the agreed-upon 3D-2D navigation flow. This patch adds the missing link to the 2D map view.

