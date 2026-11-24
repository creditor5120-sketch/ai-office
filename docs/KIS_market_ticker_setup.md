# SW AI OFFICE 앱코 주가 티커 연동 설정

## 구현 범위

- 대상: 앱코(129890) 국내주식 현재가
- 공급원: 한국투자증권 Open API
- 조회 방식: REST 현재가 조회, 30초 간격 폴링
- 브라우저에서 증권사 API를 직접 호출하지 않음
- 주문·계좌·매매 기능은 호출하지 않음
- KIS App Key/Secret은 Cloudflare Worker Secret으로만 보관
- 접근 토큰은 Cloudflare KV에 6시간 이내로 캐시
- 기존 D1 데이터베이스와 테이블은 변경하지 않음

※ REST 30초 간격 조회는 거래소 실시간 WebSocket 스트리밍과 동일하지 않습니다. 화면에는 조회 시각을 함께 표시합니다. WebSocket은 별도 상시 연결 구조가 필요하므로 후속 단계입니다.

## Cloudflare 설정 (운영 배포 전 필수)

Cloudflare 대시보드에서 기존 `ai-office-api` Worker에 아래 설정을 추가합니다.

### 1. Secrets

Workers & Pages → ai-office-api → Settings → Variables and Secrets

- `KIS_APP_KEY`: 한국투자증권 개발자센터에서 발급한 App Key
- `KIS_APP_SECRET`: 한국투자증권 개발자센터에서 발급한 App Secret

두 값 모두 Secret 유형으로 등록합니다. GitHub, HTML, 채팅, 일반 변수에 입력하지 않습니다.

### 2. KV 바인딩

Workers & Pages → ai-office-api → Settings → Bindings → KV namespace

- Variable name: `KIS_TOKEN_CACHE`
- Namespace: 새 KV namespace를 생성해 연결

이 KV는 접근 토큰만 저장합니다. 주가·업무 데이터 또는 계좌정보를 저장하지 않습니다.

### 3. 기존 설정 유지

다음 기존 항목은 삭제·변경하지 않습니다.

- `OFFICE_ACCESS_TOKEN`
- `OPENROUTER_API_KEY`
- 기존 D1 바인딩 `DB`
- 대표 승인 전용 토큰 및 기타 기존 Worker 설정

## 동작

1. v11 미리보기 화면에서 기존 서버 모드를 켜고 Worker 주소와 일반 접근 토큰을 설정합니다.
2. 화면은 Worker에 `get_market_quote` 읽기 전용 요청을 30초 간격으로 보냅니다.
3. Worker가 KV에서 KIS 접근 토큰을 확인하고, 없거나 만료 임박 시 KIS OAuth 토큰을 발급받습니다.
4. Worker가 `FHKST01010100` 현재가 API로 129890을 조회합니다.
5. 가격·전일 대비·등락률·거래량과 조회 시각을 티커에 표시합니다.

## 주의

- 이 변경은 GitHub PR 후보 코드입니다. PR 병합과 Cloudflare Worker 배포 및 Secret/KV 설정 전에는 운영 서버에 적용되지 않습니다.
- API 키나 Secret을 채팅에 보내지 마세요.
- 한국투자증권의 이용약관·시세 제공 조건 및 호출 한도를 확인한 뒤 사용하세요.
- 장 종료·휴장일에는 마지막 거래일 기준 시세가 반환될 수 있습니다.
- 지수·뉴스·공시는 아직 실제 공급원에 연결되지 않으며 연결 대기 문구를 유지합니다.
