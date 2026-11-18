# AI 국내 여행 플래너

국내 여행 일정을 만들어 주는 AI Agent 웹앱입니다.

| 영역 | 기술 |
|---|---|
| 프론트엔드 | HTML, CSS, JavaScript (ES Modules) |
| 백엔드 | Node.js, Express |
| AI | OpenAI Responses API |
| 장소 검색 | NAVER API HUB 지역 검색 API |
| 지도/경로 | NAVER Cloud Platform Maps (신규) |

## 시작하기

```bash
npm install
cp .env.example .env   # 값 입력
npm run check:env      # 설정 여부 확인 (값은 출력하지 않음)
npm run dev            # http://localhost:3000
npm run test:search    # search_places 독립 테스트 (NAVER 지역 검색 실제 호출)
npm run check:deploy   # 배포 전 점검 (비밀 정보·업로드 제외·vercel.json·진입점)
```

## 배포 (GitHub + Vercel)

구조: 루트 `app.js`가 Express 앱(`server/app.js`)을 default export → Vercel이 하나의 Function으로 실행, `public/`은 CDN이 제공. 정적 파일의 보안 헤더는 `vercel.json`(= `npm run sync:vercel`로 서버 설정에서 생성)이 담당합니다.

1. **배포 전 점검**: `npm run check:deploy` 가 모두 ✅ 인지 확인
2. **GitHub**: 비공개(private) 저장소 권장. `.env`·`data/`·`node_modules/`는 `.gitignore`로 제외되며, 커밋 시 `.githooks/pre-commit`이 키 유출을 검사합니다(`git config core.hooksPath .githooks`).
3. **Vercel 프로젝트**: GitHub 저장소를 Import 하거나 `npx vercel` 로 배포. Framework Preset은 자동(Express)으로 둡니다.
4. **환경 변수** (Vercel → Project → Settings → Environment Variables, Production)

   | 이름 | 필수 | 비고 |
   |---|---|---|
   | `OPENAI_API_KEY`, `OPENAI_MODEL` | ✅ | Sensitive 로 등록 |
   | `NAVER_API_HUB_CLIENT_ID`, `NAVER_API_HUB_CLIENT_SECRET` | ✅ | Sensitive |
   | `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET` | ✅ | Secret 은 Sensitive |
   | `APP_ACCESS_CODE` | 강력 권장 | 공개 URL 남용 방지 |
   | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | 강력 권장 | Marketplace → Upstash Redis 연결 시 자동 등록. 없으면 한도가 인스턴스별로 계산됨 |
   | `DAILY_PLAN_LIMIT` 등 한도 | 선택 | `.env.example` 참고 |

   환경 변수를 바꾼 뒤에는 **Redeploy** 해야 반영됩니다.
5. **NAVER Maps 도메인 허용**: NCP 콘솔 → Maps → Application → 해당 앱 → 수정 → *Web 서비스 URL*에 `https://<프로젝트>.vercel.app` 추가 (포트·경로 없이, 로컬용 `http://localhost`는 유지). Dynamic Map 이 체크되어 있어야 합니다.
6. **배포 후 확인**: `https://<도메인>/api/health` 에서 `missingEnv: []`, `usageStore: "redis"`, `accessCodeRequired: true` 확인 → 화면에서 장소 검색 → 일정 만들기.

## 보안 원칙

- `.env`는 `.gitignore`로 제외되고 권한은 `600`(본인만 읽기)입니다. 공유는 `.env.example`로만 합니다.
- **OpenAI 키, NAVER Client Secret**은 `server/` 코드에서만 사용합니다. 브라우저에는 `/api/config`로 **지도 SDK용 `NAVER_MAPS_CLIENT_ID`만** 전달합니다.
  → NCP 콘솔의 Maps Application > Web 서비스 URL에 **포트 없이** `http://localhost`(및 배포 도메인)만 등록하고, Dynamic Map 사용을 체크하세요.
- 서버는 기본적으로 `127.0.0.1`에만 열립니다(같은 와이파이의 다른 기기 접속 불가).
- 보안 헤더(CSP, X-Frame-Options 등), 다른 사이트에서 온 API 요청 차단, JSON 외 요청 차단, 요청 본문 10KB 제한.
- 커밋 전 키 유출 검사: `npm run check:secrets` (git 사용 시 `git config core.hooksPath .githooks`로 자동 실행)

## 비용 통제

| 장치 | 기본값 | 설정 |
|---|---|---|
| 하루 일정 생성 | 30회 | `DAILY_PLAN_LIMIT` |
| 하루 OpenAI 토큰 | 1,000,000 | `DAILY_TOKEN_LIMIT` |
| 1회 생성당 토큰 | 80,000 (도달 시 정리 단계 1회 추가) | `MAX_TOKENS_PER_RUN` |
| web_search | 1회당 2번 · 하루 30번 | `MAX_WEB_SEARCH_PER_RUN`, `DAILY_WEB_SEARCH_LIMIT`, `OPENAI_WEB_SEARCH=off` |
| NAVER 검색 / 길찾기 | 하루 500회씩 | `DAILY_SEARCH_LIMIT`, `DAILY_DIRECTIONS_LIMIT` |
| 동시 실행 | 1건 | `MAX_CONCURRENT_PLANS` |
| IP 속도 제한 | 일정 10분 5회, 검색 1분 20회 | `PLAN_RATE_LIMIT_PER_10MIN`, `SEARCH_RATE_LIMIT_PER_MIN` |
| 캐시 | 검색 6시간, 길찾기 30분 | 코드 |
| LLM 출력 상한 | 루프 2,000 / 최종 4,000 토큰 | `server/agent/travelAgent.js` |

- 한도는 한국 시간 자정에 초기화되며, 사용량은 `data/usage.json`(gitignore)에 저장되어 재시작해도 유지됩니다.
- 한도에 닿으면 외부 API를 호출하기 **전에** 429로 차단합니다. 값을 `0`으로 두면 해당 기능이 꺼집니다.
- 오늘 사용량: 화면 상단 배지(마우스를 올리면 상세) 또는 `GET /api/health`

## 폴더 구조

```
server/
  index.js               Express 진입점, 라우터 연결
  config/env.js          환경 변수 로딩·검증, 공개용 설정 분리
  middleware/            에러 처리
  routes/
    config.js            GET  /api/config   (공개 Client ID)
    places.js            GET  /api/places   Level 1
    plan.js              POST /api/plan     Level 2
    route.js             POST /api/route    Level 3
  services/
    naverSearch.js       Level 1 - 지역 검색
    openaiAgent.js       Level 2 - Responses API Agent
    naverMaps.js         Level 3 - Directions
public/
  index.html, css/style.css
  js/api.js              백엔드 호출
  js/map.js              지도 SDK 로더
  js/app.js              UI 이벤트
```

## AI Agent 구조 (Function Calling)

```
POST /api/plan (NDJSON 스트림)
  └─ Agent Loop (server/agent/travelAgent.js, 최대 12턴 · 도구 24회 · 연속 실패 5회)
       LLM(Responses API) ── 필요한 도구를 스스로 선택
         ├─ search_places     → NAVER 지역 검색        (placeId 발급)
         ├─ get_routes        → NAVER Directions 5     (구간별 거리·시간·통행료·유류비)
         ├─ calculate_budget  → 결정적 계산            (확인된 비용 + 남은 예산 권장 배분)
         └─ web_search        → OpenAI 내장            (축제·휴무 등 최신 정보)
       도구 결과 → function_call_output 으로 다시 LLM 에 전달 → 반복
  └─ 최종 정리: JSON 스키마로 placeId 기반 일정 작성
  └─ 서버 조립: placeId → NAVER 장소·좌표, 같은 구간의 길찾기 결과만 이동 정보로 연결
```

사실성 보장 장치
- 장소·좌표는 `search_places` 결과의 placeId 로만 연결 (LLM 이 좌표를 만들 수 없음)
- 이동 시간·거리·통행료·유류비는 NAVER 길찾기 값만 표시, 없으면 표시하지 않음
- `calculate_budget` 의 비용 항목은 이번 실행에서 web_search 로 확인된 출처 URL 만 인정
- 일정 구성에 필요한 후보(관광지·식당·숙소)가 부족하면 루프 종료 전 LLM 에 알려 추가 검색 유도
- `OPENAI_WEB_SEARCH=off` 로 웹 검색 비활성화 가능

## 개발 단계

- **Level 1** — 장소 검색 ✅: `services/naverSearch.js`의 `search_places({ region, keyword })`
  - `GET https://naverapihub.apigw.ntruss.com/search/v1/local` (헤더 `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY`)
  - `mapx`/`mapy`는 WGS84 경위도 × 10^7 정수 문자열 → 10^7로 나눠 사용 (실측 확인)
  - 한 번에 최대 5건, 영업시간·평점·가격은 API가 제공하지 않으므로 표시하지 않음
- **Level 2** — AI 일정 생성: `services/openaiAgent.js`에서 Responses API 호출 (장소 검색을 tool로 연결 가능)
- **Level 3** — 지도 경로: `services/naverMaps.js`로 Directions 호출 → 지도에 Polyline 표시

