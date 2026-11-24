# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering logic to ensure the representative CEO (단테) and COO (알렉스) are correctly identified and routed in the 3D office.

## 판단 근거

The current implementation of `makePixelSheet` and `makeAvatar` in `office3d.html` relies on hardcoded ID checks for 'CEO' and 'COO' to apply specific styling and routing. The previous implementation had a minor inconsistency in the `makePixelSheet` logic where the `isDante` and `isAlex` flags were derived from IDs, but the `makeAvatar` function was not consistently using the `displayPerson` object for all avatar properties. This patch ensures that the `displayPerson` object, which contains the correct name and job title, is used consistently for both the avatar creation and the staff card generation, maintaining the routing contract established in the smoke tests.

