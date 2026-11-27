# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office initialization error by ensuring the `officeTeams` and `officeDeskSlots` are correctly defined before use in the `office3d.html` script.

## 판단 근거

The `officeDeskSlots` variable was being accessed before its definition in the script, causing a runtime error that prevented the 3D office from loading. Moving the definition of `officeTeams` and `officeDeskSlots` to the top of the script ensures they are available when needed.

