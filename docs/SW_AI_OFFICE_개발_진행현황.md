# SW AI OFFICE 개발 진행 현황

기준일: 2026-11-21
개발 브랜치: `work/v315-office-workflow-bridge`
현재 브랜치 HEAD: [개발 브랜치에서 확인](https://github.com/creditor5120-sketch/ai-office/tree/work/v315-office-workflow-bridge)
PR: [#5 SW AI OFFICE v3.15 업무처리 기능 분리 연동](https://github.com/creditor5120-sketch/ai-office/pull/5) — Open / Draft / 미병합

## 1. 현재 기준 화면

- 최신 업로드 파일: `SW_AI_Office_Latest.html`
- 최신 파일 Blob SHA: `ca0414fb73ee27069fe45dfc75d2522d02d0639b`
- 실행 진입점: `office-v315-integrated.html`
- 통합 화면 iframe은 `SW_AI_Office_Latest.html`을 불러온다.
- 기존 승인 원본 `SW_AI_Office_v3_15.html`은 별도 보존하며 변경하지 않는다.
- 최신 화면의 조직 기준: 대표이사 피터, 본부장 알렉스, 경영관리팀장 데니스, 법무팀장 렉스, IR팀장 라이언, 총무팀장 에이든, 전략기획팀장 에릭, 기술·IT팀장 테오.

## 2. 완료 및 검증된 항목

- 최신 업로드 HTML을 별도 파일로 저장하고 통합 화면 연결 대상을 최신 파일로 변경.
- 최신 HTML의 조직 명칭을 기존 확정 조직 기준에 맞게 반영.
- 기존 승인 원본의 Blob 무결성 검사를 자동화.
- 업무 엔진 브리지의 DOM 연결 지점(`aiCfgBtn`, `gl`, `stage`, `chat`, `msgs`) 회귀 검사 추가.
- 최신 HTML의 중복 ID 회귀 검사 추가.
- 업무 지시·직원 명단 전달·진행 표시·실패 기록·직원 개인 대화 유지 테스트 통과.
- Worker 인증·대표 승인·감사 이력 계약 테스트 통과.
- Chromium 브라우저에서 최신 사무실 렌더링 및 업무 엔진 패널 열기/닫기 검증 통과.
- D1 사전 점검 SQL이 읽기 전용인지, 필수 테이블·컬럼·UNIQUE 제약을 검사하는 자동 테스트 추가.
- Worker CORS에 GitHub Pages 운영 도메인과 승인된 Cloudflare Pages 미리보기 도메인만 허용하는 명시적 allowlist 및 미허용 Origin 차단 테스트 추가.
- 데스크톱 및 iPad 폭 화면 캡처 아티팩트 업로드 통과.
- 기존 업무 브리지의 구조적 충돌을 확인함: 최신 HTML의 `runDirective()`는 알렉스의 계획 JSON·전문 직원 실행·팀장 검수·최종 보고를 위해 여러 차례 `callConfiguredLLM`을 호출하므로, 이 함수를 Worker 최종 보고로 대체하면 계획 단계의 JSON 계약이 깨질 수 있음.
- 이를 해결하기 위해 최신 HTML의 원본 코드를 수정하지 않고 `workflow-bridge-latest.js`를 추가. 전송 버튼 클릭 및 Enter 키 이벤트 중 알렉스가 선택된 경우에만 Worker로 최초 지시를 전달하고, 다른 직원의 개인 대화는 기존 AI 연결을 그대로 사용하도록 변경.
- 새 어댑터는 최신 HTML의 `EMP` 직원 명단을 Worker 입력 형식으로 변환하고 대표이사 피터를 `COO`로 전달. 업무 ID·멱등성 키 저장, 동일 지시 재개, 진행 단계 표시, 실제 오류 노출을 처리.
- 실행 래퍼 `office-v315-integrated.html`은 계속 `SW_AI_Office_Latest.html`을 iframe으로 불러오며, 주입하는 어댑터만 `workflow-bridge-latest.js`로 변경. 승인 원본 `SW_AI_Office_v3_15.html`의 Blob SHA 검증은 유지.
- 최신 브리지 런타임 테스트 3개 추가: 알렉스 지시의 Worker 전달·COO/6개 팀장 명단 확인, 서버 오류 시 미완료 표시 및 재개 데이터 보존, 다른 직원 대화 비가로채기. [GitHub Actions #44858251878](https://github.com/creditor5120-sketch/ai-office/actions/runs/44858251878) — 24개 브리지 테스트, Worker 계약 테스트, D1 사전 점검, Chromium 통합 화면 검증 전체 성공.
- 직원 명단 사전검증에서 오류가 발생해도 알렉스 대화창에 실제 실패 사유가 표시되도록 보강. 최종 코드 커밋 `35a1a50`의 [GitHub Actions #44858441937](https://github.com/creditor5120-sketch/ai-office/actions/runs/44858441937) — 전체 성공.
- 알렉스 업무 시작 상태 문구를 실제 진행 상태 목록과 일치시키도록 최종 조정. 커밋 `d9caaf7`의 [GitHub Actions #44858574943](https://github.com/creditor5120-sketch/ai-office/actions/runs/44858574943) — Worker 계약·브리지 24개 테스트·D1 사전 점검·Chromium 렌더링 및 화면 캡처 전체 성공.
- Worker 업무 요청 입력 검증 강화: 지시문·직원 수·직원 필드·업무 ID·멱등성 키 길이를 제한하고, D1 접수 전에 형식 오류를 거부하며 실행에 필요한 필드만 입력 스냅샷에 저장. 관련 회귀 테스트 추가.
- 추가 방어: 인증 후 JSON 파싱 전에 요청 본문 스트림의 실제 크기를 최대 1,500,000바이트로 제한하고 Content-Length도 선검사. 본문 크기 초과 회귀 테스트 추가.
- 조회·대표 결정 API 입력 검증 보강: 업무 ID를 문자열·128자 이내로 제한하고, 대표 결정 및 반려 사유의 자료형을 검사하며 반려 사유는 4,000자 이내로 제한. 관련 회귀 테스트 통과.
- 최신 HTML·브리지·D1 사전 점검·Worker CORS allowlist·Chromium 데스크톱/iPad 검증 실행: [GitHub Actions #44850603793](https://github.com/creditor5120-sketch/ai-office/actions/runs/44850603793) — 전체 성공.
- 재개 경로 추가 점검에서 AI 체크포인트 키(v51_ai_call_숫자)를 판독하는 정규식의 이스케이프 오류를 발견해 수정. 정상 저장된 체크포인트가 재개 시 손상 데이터로 오인될 수 있던 문제이며, 숫자 인덱스 0·27 및 비숫자 키 거부를 확인하는 회귀 테스트를 추가함. 수정 커밋: `c2296ed`, 회귀 테스트 커밋: `18b8ba2`. 이후 브랜치 HEAD `56848c6`에서 CI 실행 #44852487862가 성공해 해당 변경분의 자동 검증을 확인함.
- 2026-11-21 커밋 `6c1988c`의 CI에서 Worker 입력 검증 테스트 48개 중 1개가 실패함. 원인은 빈 직원 ID 검증보다 필수 COO 존재 검사가 먼저 실행되어 테스트가 기대한 오류와 다른 오류를 반환한 순서 문제. 검증 순서를 바로잡은 후 브랜치 HEAD `56848c6`의 CI 실행 #44852487862에서 전체 작업 성공을 확인함. 이는 과거 커밋의 테스트 실패이며 운영 Worker 장애를 의미하지 않음.

- 2026-11-22 최신 브랜치 HEAD `570d95a7cb0c555c6283276c57f69e326c319886`에서 프로젝트 전용 Cloudflare Pages 미리보기 도메인 허용 규칙과 미허용 Origin 차단 테스트를 확인함. GitHub Actions 실행 [#44985255918](https://github.com/creditor5120-sketch/ai-office/actions/runs/44985255918)은 Worker 인증·승인 계약, 최신 브리지 테스트, 읽기 전용 D1 사전 점검, Chromium 사무실 렌더링, 데스크톱/iPad 화면 캡처까지 전체 성공. 브라우저 자동 검증은 성공했으나 운영 Worker·D1·AI API Secret을 이용한 실제 업무 1건의 end-to-end 실행은 아직 검증하지 않음.

## 3. 아직 완료로 판정하지 않은 항목

- 실제 운영 Cloudflare Worker 버전 및 Secret 설정 확인.
- 실제 운영 D1의 테이블·컬럼·인덱스 호환성 확인.
- 운영 D1 Time Travel 지원 여부 및 백업 상태 확인.
- 별도 검증용 D1에 백업을 복원하고 무결성·행 수·감사 이력을 대조하는 시험.
- 인증된 실제 환경에서 대표 지시부터 직원 수행·검수·대표 승인까지 업무 1건 end-to-end 실행.
- GitHub Pages 및 Worker 운영 배포.

위 항목은 저장소의 코드 테스트만으로 완료 판정할 수 없다. Cloudflare 계정 접근·Secret·D1 상태가 확인되지 않은 상태에서 운영 구성을 추측하거나 변경하지 않는다.

## 4. 다음 실행 순서

1. 최신 CI 성공 상태와 브랜치 HEAD를 다시 확인한다.
2. 실제 운영 Worker·D1을 변경하지 않는 범위에서 현재 배포 버전과 읽기 전용 스키마 사전 점검 방법을 확인한다.
3. Cloudflare 계정 연결 또는 운영자 실행이 필요한 항목을 구분하고, 가능한 읽기 전용 검증을 먼저 완료한다.
4. 검증용 D1이 확보되면 백업 복원 및 테스트 업무 실행을 수행한다.
5. 실서비스 end-to-end 검증 전까지 PR은 Draft로 유지하고 병합·운영 배포하지 않는다.

## 5. 변경 금지 경계

- 운영 D1 데이터 삭제·수정·스키마 변경 금지.
- 운영 Worker 배포 및 Secret 변경 금지.
- GitHub Pages 공개 배포 및 PR 병합 금지.
- 기존 승인 원본 HTML 덮어쓰기 금지.
