# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office initialization error by ensuring the `officeDeskSlots` array is correctly populated and accessible during the avatar placement phase.

## 판단 근거

The smoke test failed because the `officeDeskSlots` array was defined inside the `build()` function scope but accessed globally during avatar placement. Moving the definition to the global scope ensures the 3D office correctly initializes and places all 31 staff members as required by the audit contract.

