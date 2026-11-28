# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office avatar selection and detail view toggle logic to ensure the COO (알렉스) is correctly selected and displayed upon initialization and detail view toggling.

## 판단 근거

The current implementation of the detail view toggle and initial selection logic had a slight inconsistency where the COO (알렉스) might not be correctly selected or the UI state might not be fully synchronized. This patch ensures that the COO is explicitly selected and the UI is updated correctly when the detail view is toggled, maintaining the agreed-upon routing contract.

