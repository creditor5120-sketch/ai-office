# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office smoke test to correctly handle the representative routing regression test.

## 판단 근거

The smoke test was failing because it expected the routing payload to be the 3rd element in the `routedPayloads` array, but the test sequence had changed, causing an index out-of-bounds error. The patch updates the test to correctly reference the payload index for the resumed task.

