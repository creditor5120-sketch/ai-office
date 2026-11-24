# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the 3D office staff card rendering logic to correctly display the 31 staff members.

## 판단 근거

The current implementation of `refreshStaffCards` and the initial staff card generation logic in `office3d.html` relies on `avatars.length` which includes the CEO (Dante) and COO (Alex). The loop `for(const p of directory)` correctly iterates over the 30 staff members, but the `avatars` array already contains Dante and Alex, leading to an index mismatch when assigning desk slots. By correctly calculating the slot index based on the `avatars` array length and ensuring the `avatars` array is fully populated before generating cards, we ensure all 31 slots are correctly mapped.

