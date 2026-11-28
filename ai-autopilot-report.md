# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Implement the representative-to-Alex routing contract and verify it with a regression test.

## 판단 근거

The routing contract requires that selecting the CEO (단테) in the 3D office must route the task to the COO (알렉스). This is a critical path for the AI virtual company workflow. The patch updates the `selectAvatar` function in `office3d.html` to correctly identify the CEO and route the task to the COO, and the smoke test verifies this behavior.

