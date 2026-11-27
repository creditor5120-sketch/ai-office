# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office initialization error by ensuring the `office3d.html` script correctly handles the `officeTeams` and `officeDeskSlots` definitions before they are accessed in the `makeAvatar` loop.

## 판단 근거

The `office3d.html` script was attempting to access `officeDeskSlots` before it was fully populated in the scope, leading to potential runtime errors during the avatar initialization phase. Moving the `officeDeskSlots` definition and the team-based desk generation logic before the avatar creation loop ensures all required data is available.

