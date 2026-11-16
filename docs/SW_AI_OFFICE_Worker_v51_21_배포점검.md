# SW AI OFFICE Worker v51.21 배포 점검

## 배포 대상

- 저장소: creditor5120-sketch/ai-office
- 브랜치: main
- 파일: worker/SW_AI_OFFICE_Worker_v51_21_audit_timeline.js
- 버전: v51.21
- 운영 Worker URL: https://ai-office-api.creditor5120.workers.dev/

## 기존 설정 유지

Cloudflare Worker의 기존 설정을 삭제하거나 이름을 바꾸지 않는다.

- D1 바인딩: DB
- Secret: OFFICE_ACCESS_TOKEN
- Secret: OPENROUTER_API_KEY

## 추가할 Secret

- 이름: REPRESENTATIVE_ACCESS_TOKEN
- 용도: 대표 승인·반려 전용 인증
- 일반 업무 API 인증값(OFFICE_ACCESS_TOKEN)과 반드시 다른 값으로 설정한다.
- 실제 비밀값은 GitHub 저장소, 소스 코드, 업무 지시문, 대화창에 입력하지 않는다.

## 배포 전 확인

1. 현재 운영 Worker 소스와 바인딩·Secret을 확인한다.
2. v51.21 전체 소스로 교체한다.
3. 기존 DB 바인딩과 Secret이 유지되는지 확인한다.
4. REPRESENTATIVE_ACCESS_TOKEN Secret을 추가한다.
5. 저장 후 배포한다.

## 배포 후 확인

1. 일반 업무 요청이 기존 OFFICE_ACCESS_TOKEN으로 인증되는지 확인한다.
2. 업무 이력 조회(get_task_history)가 정상 응답하는지 확인한다.
3. 대표 승인 요청은 대표 전용 토큰이 없거나 틀리면 401로 거부되는지 확인한다.
4. 대표 전용 토큰까지 맞으면 승인·반려가 기록되는지 확인한다.
5. 검수 게이트가 통과하지 않은 업무의 승인이 서버에서 409로 거부되는지 확인한다.
6. 같은 결정의 재요청은 중복 기록되지 않고, 반대 결정으로 덮어쓰기도 차단되는지 확인한다.

## 주의

- 이 파일은 GitHub에 저장된 배포 후보 소스다. Cloudflare 운영 Worker에 자동 배포된 상태가 아니다.
- 대표 전용 토큰은 별도 접근 통제 수단이며, 개인별 계정 로그인이나 실명 신원 확인을 대체하지 않는다.
- 외부 발송·계약 체결 등 실제 외부 실행은 계속 자동 수행하지 않는다.
