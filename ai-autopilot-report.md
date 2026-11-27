# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the routing contract regression in the 3D office and ensure truthful UI representation of the specialist assignment.

## 판단 근거

The routing contract requires that selecting the CEO (단테) in the 3D office routes the request to the COO (알렉스). The previous implementation had a potential gap where the UI might not consistently reflect this routing or the specialist assignment status. This patch ensures the `selectAvatar` function and the `submitSelectedTask` logic strictly adhere to the contract, and adds a regression test to verify that the payload sent to the API correctly identifies the employee as '알렉스' when the CEO is selected.

