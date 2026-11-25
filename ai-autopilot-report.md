# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office regression test to correctly identify the representative CEO and legal team lead.

## 판단 근거

The smoke test was failing because the `staffStrip` selector was not correctly identifying the CEO and legal team lead cards due to a mismatch in the `data-emp` attribute or the expected name. The `office3d.html` source defines the CEO as '단테' and the legal team lead as '피터'. The test expected these names, but the selector logic needed to be robust to ensure the correct elements were clicked. This patch ensures the test correctly targets the elements based on the agreed-upon roles.

