# SW AI OFFICE v3.15 업무처리 연동 설치·검증 기준

## 1. 목적과 보존 원칙

이 구성은 완성된 `SW_AI_Office_v3_15.html`을 직접 편집하지 않고 기존 SW AI OFFICE 업무처리 Worker와 연결한다.

- 사무실 원본 파일의 HTML·CSS·JavaScript를 수정하지 않는다.
- `office-v315-integrated.html`이 원본 파일을 iframe으로 표시한다.
- `workflow-bridge-v315.js`는 iframe 안에 별도 스크립트로 주입된다.
- 기존 `office3d.html`, `index.html` 및 다른 사무실 디자인 파일은 이 연동 대상이 아니다.
- 운영 Worker 배포, D1 변경, GitHub Pages 공개는 별도 승인 전에는 수행하지 않는다.

## 2. 업무 처리 연결 구조

대표가 사무실에서 알렉스를 선택해 지시하면 다음 흐름으로 전달한다.

1. 사무실의 직원 명단(EMP)에서 직원 ID·이름·팀·직책·업무 지침을 읽는다.
2. 대표이사 캐릭터는 Worker가 요구하는 `COO` 직원 데이터로 변환한다.
3. 업무 지시와 직원 명단을 기존 Worker에 전달한다.
4. Worker는 D1에 업무를 접수하고, 단계별 실행·체크포인트·감사 이력을 저장한다.
5. Worker가 1회 요청의 AI 호출 한도에 도달하면 같은 `taskId`와 `idempotencyKey`로 재개한다.
6. 완료 보고서와 전문 직원 결과물을 사무실 대화창에 표시한다.
7. 대표 화면은 D1의 최근 업무 목록을 복원하고, 선택한 업무의 저장 보고서·전문 직원 결과물·감사 이력을 다시 불러온다.
8. 브라우저를 새로 열어도 iframe 로컬 저장소의 미완료 업무 ID와 지시문을 확인해 재개 방법을 안내한다. 알렉스에게 동일 지시문을 다시 보내면 최초 `taskId`·`idempotencyKey`로 재시도한다.
9. 별도 대표 인증으로 승인 또는 반려를 기록한다.

다른 직원을 선택한 개인 대화는 기존 사무실의 대화 동작을 유지한다. 알렉스에게 지시한 업무만 업무처리 Worker로 보낸다.

## 3. 파일

- `SW_AI_Office_v3_15.html`: 원본 사무실 파일
- `office-v315-integrated.html`: 원본을 변경하지 않고 표시하는 실행 래퍼
- `workflow-bridge-v315.js`: 사무실 직원 데이터와 Worker API 사이의 어댑터
- `worker/SW_AI_OFFICE_Worker_v51_22_completion_audit.js`: Worker v51.26 코드
- `tests/worker-auth-audit.test.mjs`: 인증·승인·감사 API 계약 테스트
- `tests/v315-workflow-bridge.test.mjs`: 사무실 연동·진행 표시·실패 이력 테스트

## 4. Cloudflare 설정 확인

실제 비밀값은 소스 코드나 GitHub에 입력하지 않는다. Cloudflare Worker 대시보드에서 Secret을 확인·설정한다.

| 이름 | 용도 |
|---|---|
| `OFFICE_ACCESS_TOKEN` | 일반 업무 요청 및 이력 조회 인증 |
| `REPRESENTATIVE_ACCESS_TOKEN` | 대표 승인·반려 전용 인증. 일반 토큰과 다른 값 |
| `OPENROUTER_API_KEY` | 우선 사용하는 기존 OpenRouter API 인증값 |
| `GEMINI_API_KEY` | OpenRouter Secret이 없을 때 사용하는 Gemini API 인증값(선택) |
| `DB` | 기존 D1 바인딩 |

주의:
- 이 브랜치의 Worker 코드는 `OPENROUTER_API_KEY`가 있으면 OpenRouter를 우선 사용하고, 없으면 `GEMINI_API_KEY`로 Gemini를 사용한다. 기존 OpenRouter Secret을 유지한 채 연동할 수 있으며, 두 키가 모두 있으면 OpenRouter가 우선된다.
- 기존 D1 데이터베이스를 새로 만들거나 교체하지 않는다.
- 운영 Worker가 `get_recent_tasks`, `get_task_history`, `get_representative_decision`, `representative_decision` action을 지원하는지 확인한다.
- `get_recent_tasks`는 D1에 저장된 최근 업무 목록(최대 50건)을 반환한다. `get_task_history`는 단계별 감사 이력과 저장된 최종 보고서·전문 직원 결과물을 함께 반환한다.
- 브라우저 로컬 이력이 없더라도 서버 인증 후 최근 업무 목록을 복원한다. 목록에서 업무를 선택하면 서버 저장 결과로 로컬 기록을 보완한다.
- 브라우저를 다시 열었을 때 미완료 업무가 로컬 저장소에 남아 있으면 실행 래퍼가 업무 ID·최초 지시문·저장 시각·재개 방법을 표시한다. 동일 지시문과 동일 직원 명단으로 24시간 이내 재전송할 때만 기존 업무 ID를 재사용하며, 직원 명단 변경 또는 24시간 경과 시 새 업무로 접수한다.
- 동일 멱등성 키의 서버 업무가 이미 완료된 경우 Worker는 저장된 최종 결과를 반환하므로 재전송으로 AI 업무를 중복 수행하지 않는다.
- 대표 전용 Secret이 설정되지 않으면 대표 승인·반려 API는 503을 반환한다.
- 인증값은 사용자에게 직접 전달하거나 채팅에 붙여넣지 않는다. 실행 화면의 연결 메뉴에 직접 입력한다.

## 5. 실행 및 검증 순서

1. 운영 Worker 버전과 D1 바인딩·테이블·컬럼·인덱스를 읽기 전용으로 확인한다.
2. Worker 코드가 요구하는 Secret 이름과 현재 운영 Secret을 대조한다.
3. 운영 DB 백업 및 복구 가능성을 확인한다.
4. 운영 반영 승인을 받은 후 Worker를 배포한다.
5. GitHub Pages 배포 승인을 받은 후 다음 파일을 같은 경로에 게시한다.
   - `SW_AI_Office_v3_15.html`
   - `office-v315-integrated.html`
   - `workflow-bridge-v315.js`
6. `office-v315-integrated.html`을 열고 일반 인증값을 입력한다.
7. 알렉스에게 소규모 테스트 업무를 지시한다.
8. D1 업무 이력과 단계별 감사 이력을 조회한다.
9. 최종 검수 통과 전 대표 승인 요청이 거부되는지 확인한다.
10. 대표 전용 인증값으로 승인 또는 반려 기록이 한 번만 저장되는지 확인한다.

## 6. 테스트 및 한계

- GitHub Actions의 Worker 계약 테스트는 모의 D1을 사용한다. 운영 D1의 실제 스키마나 운영 Secret을 검증하지 않는다.
- 브리지 테스트는 실제 사무실 HTML의 직원 데이터 형식, 알렉스 지시 전달, 진행 상태 표시, 실패 이력 보존, 개인 대화 유지 여부와 통합 래퍼 JavaScript 구문을 검사한다.
- Worker 테스트는 서버 최근 업무 목록 조회, D1 미연결 시 차단, 저장 보고서·결과물 복원 응답을 검사한다.
- 실행 잠금은 5분 임대로 설정하고, 업무 상태 전환·시도 횟수 증가·잠금 획득을 단일 조건부 D1 UPDATE로 처리한다. 동시 재개 요청 중 잠금을 획득한 요청만 실행 시도 횟수를 올린다.
- 잠금 소유권이 바뀌거나 임대가 만료된 이전 실행은 토큰·임대 만료 시각 조건으로 잠금 갱신·업무 상태 변경·체크포인트 저장·감사 이벤트 기록이 차단된다. 취소 시 만료된 잠금도 함께 해제하고 완료된 결과를 취소로 덮어쓰지 않는다. 성공 완료·실패 상태 확정도 유효한 임대 안에서만 반영한다.
- 자동 테스트는 모의 D1 기반이므로 실제 운영 데이터 복구·백업 복원 검증을 대신하지 않는다.
- 운영 Worker URL은 `https://ai-office-api.creditor5120.workers.dev/`이다.
- 운영 환경의 실제 업무 1건을 실행하기 전에는 실서비스 연동 완료로 판정하지 않는다.
- 대표 전용 토큰은 별도 인증 수단일 뿐 개인별 계정 로그인이나 실명 신원 확인을 제공하지 않는다.
- 대표 승인 이력은 D1 감사 이벤트에 추가 기록된다. 외부 발송·계약 체결 등 실제 외부 행위는 자동 실행하지 않는다.
