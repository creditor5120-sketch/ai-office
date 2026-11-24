# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office avatar seating logic to correctly align with the 31-desk layout.

## 판단 근거

The current `office3d.html` implementation of `syncAvatarWorkStates` and the avatar initialization logic incorrectly assumes a 1:1 mapping between the 31 desk slots and the 31 employees, but the `officeDeskSlots` array was being populated with a fallback `desk(0,0)` call that could lead to overlapping avatars if the slot count was insufficient. The patch ensures the avatar initialization loop correctly iterates through the defined `officeDeskSlots` and maintains the 31-desk contract, preventing visual overlap and ensuring each employee has a designated desk.

