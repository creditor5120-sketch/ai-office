# SW AI OFFICE 자동 개발 점검

- 결과: 검토용 수정안 생성
- 요약: Implement a robust idempotent task resume mechanism and fix the routing contract regression.

## 판단 근거

The current implementation of task resumption and routing needs to be strictly idempotent to prevent duplicate AI calls. The patch ensures that when a task is resumed, the original taskId and idempotencyKey are preserved, and the routing logic correctly identifies the CEO-to-COO path while maintaining individual employee routing for others. This addresses the priority of idempotent retry/resume and truthful progress.

