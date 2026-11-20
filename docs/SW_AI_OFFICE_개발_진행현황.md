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
- 최신 HTML·브리지·D1 사전 점검 회귀 검증 실행: [GitHub Actions #44840435259](https://github.com/creditor5120-sketch/ai-office/actions/runs/44840435259) — 성공. CORS allowlist 변경은 후속 CI에서 재검증 중.

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
