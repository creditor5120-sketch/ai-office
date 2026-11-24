# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'activeCount' element ID in the 3D office UI to ensure staff count displays correctly.

## 판단 근거

The 3D office UI references 'activeCount' in the HTML, but the script logic for updating this element was missing, causing the staff count to remain as '-' in the UI. This patch ensures the count is correctly populated upon initialization.

