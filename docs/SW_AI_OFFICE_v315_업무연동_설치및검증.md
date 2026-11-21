# SW AI OFFICE v3.15 업무처리 연동 설치·검증 기준

## 1. 목적과 보존 원칙

이 구성은 사용자가 제공한 최신 사무실 파일 `SW_AI_Office_Latest.html`을 기준 화면으로 사용하고, 기존 SW AI OFFICE 업무처리 Worker와 연결한다. 기존 승인 원본 `SW_AI_Office_v3_15.html`은 비교·복구용으로 보존한다.

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


## 2-1. 실제 실행 HTML 선택 기준

- 사용자가 제공한 최신 사무실 화면은 `SW_AI_Office_Latest.html`이며, 3D 공간·직원 표현·기존 대화 기능을 기준으로 삼는다.
- 기존 승인 원본 `SW_AI_Office_v3_15.html`은 별도 보존하며 최신 기준 화면으로 덮어쓰지 않는다.
- 업무처리 기능까지 연결해 실행할 때는 **`office-v315-integrated.html`을 실행 진입점으로 사용한다.**
- 실행 래퍼가 `SW_AI_Office_Latest.html`을 iframe으로 불러온 다음, 같은 화면 안에 `workflow-bridge-v315.js`를 주입한다. 따라서 사용자는 기존 사무실 화면에서 그대로 직원을 선택하고 대화할 수 있다.
- 업무 엔진 연결·이력·대표 승인 패널은 원본 상단의 AI 설정 버튼 옆에 `업무 엔진` 버튼으로 연결한다. 별도 화면 모서리에 떠 있는 버튼을 추가하지 않으며, 열림 상태는 `aria-expanded`와 접근성 이름에도 반영한다.
- 알렉스에게 지시한 업무만 업무처리 Worker로 전달한다. 다른 직원과의 1:1 대화는 원본 HTML의 기존 대화 함수를 그대로 사용한다.
- 원본 HTML을 직접 수정하지 않는 것은 기능 누락이 아니라 원본 보존을 위한 구조다. 원본 HTML 파일을 단독으로 열면 업무처리 브리지·서버 이력·대표 승인 화면은 연결되지 않는다.
- GitHub Pages에 반영할 때는 원본 HTML, 실행 래퍼, 브리지 파일을 동일한 배포 경로에 함께 둬야 한다.

## 3. 파일

- `SW_AI_Office_Latest.html`: 사용자가 제공한 최신 사무실 기준 화면
- `SW_AI_Office_v3_15.html`: 변경하지 않고 보존하는 기존 승인 원본
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
- Worker CORS는 GitHub Pages 운영 주소(`https://creditor5120-sketch.github.io`)와 승인된 Cloudflare Pages 미리보기 주소(`https://work-v315-office-workflow-br.sw-ai-office-preview.pages.dev`)만 허용한다. 다른 Origin은 응답의 허용 Origin으로 반영하지 않는다.
- CORS 허용은 인증이 아니다. 모든 POST 요청은 별도의 `OFFICE_ACCESS_TOKEN`을 요구하며 대표 결정은 추가로 `REPRESENTATIVE_ACCESS_TOKEN`을 요구한다.
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

1. 운영 Worker 버전과 D1 바인딩·테이블·컬럼·인덱스를 읽기 전용으로 확인한다. 읽기 전용 점검 SQL은 `docs/D1_READ_ONLY_PREFLIGHT.sql`을 사용한다.
2. Worker 코드가 요구하는 Secret 이름과 현재 운영 Secret을 대조한다.
3. 운영 DB 백업 및 복구 가능성을 확인한다. 백업 파일 또는 시점 복구 지점을 확보한 뒤 운영 DB와 분리된 검증용 D1에 복원하고, `PRAGMA integrity_check`, 테이블별 행 수, 업무 상태별 건수, 업무별 이벤트·체크포인트 연결 상태를 대조한다. 운영 DB에 대한 복원·초기화 시험은 금지한다.
4. 운영 반영 승인을 받은 후 Worker를 배포한다.
5. GitHub Pages 배포 승인을 받은 후 다음 파일을 같은 경로에 게시한다.
   - `SW_AI_Office_Latest.html`
   - `office-v315-integrated.html`
   - `workflow-bridge-v315.js`
6. `office-v315-integrated.html`을 열고 일반 인증값을 입력한다.
7. 알렉스에게 소규모 테스트 업무를 지시한다.
8. D1 업무 이력과 단계별 감사 이력을 조회한다.
9. 최종 검수 통과 전 대표 승인 요청이 거부되는지 확인한다.
10. 대표 전용 인증값으로 승인 또는 반려 기록이 한 번만 저장되는지 확인한다.

## 6. D1 스키마 사전 확인 기준

읽기 전용 사전 점검에서 다음 컬럼이 실제 운영 D1에 존재하는지 확인한다. 아래 목록은 현재 Worker SQL이 참조하는 컬럼 기준이며, 운영 DB가 이 구조와 일치한다고 아직 확인된 것은 아니다.

- `tasks`: `task_id`, `idempotency_key`, `task`, `status`, `current_stage`, `input_json`, `partial_result_json`, `error_message`, `attempt_count`, `created_at`, `updated_at`, `started_at`, `completed_at`, `control_request`, `lock_token`, `lease_expires_at`, `execution_version`, `checkpoint_stage`, `checkpoint_json`
- `task_events`: `event_id`, `task_id`, `event_type`, `actor`, `stage`, `detail_json`, `created_at`
- `task_checkpoints`: `checkpoint_id`, `task_id`, `stage_key`, `stage_name`, `checkpoint_json`, `created_at`

추가로 `tasks.idempotency_key`와 `task_checkpoints(task_id, stage_key)`의 중복 방지 제약 및 관련 인덱스가 실제로 존재하는지 확인한다. 컬럼이나 제약이 누락된 경우 운영 스키마를 임의로 변경하지 말고, 기존 데이터 백업과 별도 마이그레이션 검토 후 승인된 변경 계획을 수립한다.

## 6-1. 백업·복구 운영 절차

백업 방식 확인, 정기 Export, 복구, 별도 검증용 D1 복원 및 복구 완료 판정은 `docs/SW_AI_OFFICE_D1_백업_복구_운영절차.md`를 기준으로 한다. 현재 운영 D1의 Time Travel 지원 여부와 R2 정기 백업 구성은 아직 확인되지 않았으며, 문서 작성이나 자동 테스트만으로 운영 백업이 활성화되었다고 판단하지 않는다.

## 7. 테스트 및 한계

- GitHub Actions의 Worker 계약 테스트는 모의 D1을 사용한다. 운영 D1의 실제 스키마나 운영 Secret을 검증하지 않는다.
- 브리지 테스트는 실제 사무실 HTML의 직원 데이터 형식, 알렉스 지시 전달, 진행 상태 표시, 실패 이력 보존, 개인 대화 유지 여부와 통합 래퍼 JavaScript 구문을 검사한다.
- 브라우저 스모크 테스트는 원본 사무실 HTML을 실제 Chromium iframe으로 렌더링하고, 업무 엔진 버튼의 열기·닫기 및 접근성 상태를 확인한다. 데스크톱과 iPad 폭의 화면 캡처를 GitHub Actions 아티팩트로 보관한다.
- Worker 테스트는 서버 최근 업무 목록 조회, D1 미연결 시 차단, 저장 보고서·결과물 복원 응답을 검사한다.
- 업무 요청 입력은 지시문 100,000자, 직원 50명, 직원 ID 128자, 이름·팀·직책 각 200자, 직원별 지침 10,000자, 업무 ID·멱등성 키 각 128자로 제한한다. 필수 필드 형식과 직원 ID를 D1 접수 전에 검사하고, D1에는 실행에 필요한 검증된 필드만 저장한다. 요청 본문 전체는 JSON 파싱 전에 최대 1,500,000바이트로 제한하며, Content-Length와 실제 스트림 크기를 모두 검사한다 업무 이력·대표 결정 조회 API도 taskId를 문자열·128자 이내로 검증하고, 대표 결정 값과 반려 사유의 자료형을 확인하며 반려 사유는 4,000자를 초과하면 거부한다.
- 한 번의 요청에서 다음 AI 호출 단위로 넘어가기 위한 정상 `SW_AI_YIELD`는 AI 호출 실패 감사 이벤트로 기록하지 않는다. API 할당량 대기·일시정지·시간 초과는 별도 상태와 이벤트로 구분한다.
- 재개 시 D1에 저장된 AI 체크포인트는 버전·호출 순번·서명·결과 형식을 모두 확인한다. 호출 순번이 0부터 연속인지, `tasks.checkpoint_json`의 마지막 호출 순번·재개 전략 및 `checkpoint_stage`가 `task_checkpoints`의 실제 저장 내역과 일치하는지도 대조한다. 체크포인트가 누락·손상되었거나 요약 포인터와 불일치하면 AI를 다시 호출하기 전에 재개를 중단해 중복 호출과 잘못된 결과 재사용을 막는다.
- 실행 잠금은 8분 임대로 설정한다. AI 제공자 호출의 최대 재시도 대기(3회×60초 및 재시도 지연)를 출력 한도 초과 시의 이어쓰기 호출 1회까지 합산해도 50초 이상의 여유가 남도록 했다. 업무 상태 전환·시도 횟수 증가·잠금 획득은 단일 조건부 D1 UPDATE로 처리하며, 동시 재개 요청 중 잠금을 획득한 요청만 실행 시도 횟수를 올린다.
- 잠금 소유권이 바뀌거나 임대가 만료된 이전 실행은 토큰·임대 만료 시각 조건으로 잠금 갱신·업무 상태 변경·체크포인트 저장·감사 이벤트 기록이 차단된다. 잠금 갱신 자체도 기존 임대가 아직 유효한 경우에만 허용해 만료된 실행의 소유권 부활을 막는다. 취소 시 만료된 잠금도 함께 해제하고 완료된 결과를 취소로 덮어쓰지 않는다. 성공 완료·실패 상태 확정도 유효한 임대 안에서만 반영한다.
- 자동 테스트는 모의 D1 기반이므로 실제 운영 데이터 복구·백업 복원 검증을 대신하지 않는다.
- 운영 Worker URL은 `https://ai-office-api.creditor5120.workers.dev/`이다.
- 운영 환경의 실제 업무 1건을 실행하기 전에는 실서비스 연동 완료로 판정하지 않는다.
- 대표 전용 토큰은 별도 인증 수단일 뿐 개인별 계정 로그인이나 실명 신원 확인을 제공하지 않는다.
- 대표 승인 이력은 D1 감사 이벤트에 추가 기록된다. 외부 발송·계약 체결 등 실제 외부 행위는 자동 실행하지 않는다.
