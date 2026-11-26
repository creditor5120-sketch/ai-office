# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Fix the missing 'representativeDecision' field in the compactTaskHistoryRecord function to ensure representative approval status is correctly saved and restored.

## 판단 근거

The `compactTaskHistoryRecord` function was missing the `representativeDecision` field, causing the representative's approval/rejection status to be lost when saving or restoring task history. This patch adds the field to the compaction logic, ensuring the UI correctly reflects the decision state.

