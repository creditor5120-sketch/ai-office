# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering logic to correctly map character names and roles, ensuring the 3D office UI truthfully reflects the specialist assignment and team-lead review status.

## 판단 근거

The 3D office was using a hardcoded character mapping that did not fully align with the integrated workflow requirements. By updating the `makeStaffCard` and `makeAvatar` logic to dynamically use the `characterNames` map and ensuring the `staffStatus` is correctly updated from `readEmployeeStates`, the UI now truthfully reflects the specialist assignment and collaboration status as requested.

