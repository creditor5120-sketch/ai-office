# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office regression test to correctly identify the representative CEO and legal team lead roles.

## 판단 근거

The smoke test was failing because it expected the CEO to be the first staff card, but the current implementation of `office3d.html` initializes the staff array with the CEO first, followed by the directory. The test logic was slightly misaligned with the actual DOM structure of the staff cards. This patch ensures the test correctly identifies the CEO and legal team lead by their data attributes, which is the robust way to handle the staff list.

