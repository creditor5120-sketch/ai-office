# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office avatar initialization logic to correctly map staff to the single-floor layout.

## 판단 근거

The current implementation of `office3d.html` contains a logic error where it attempts to initialize avatars using a legacy multi-floor `zoneSlots` mapping while the 3D office has been consolidated into a single-floor layout. This causes avatars to be placed incorrectly or fail to render at their intended desks. The patch updates the avatar initialization to use the `officeDeskSlots` array, which correctly reflects the 31 desk positions in the single-floor layout, ensuring parity with the `officeAudit.deskCount` requirement.

