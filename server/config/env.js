// 환경 변수 로딩/검증을 한 곳에서 관리합니다.
// 비밀 값(OpenAI 키, Secret)은 이 모듈을 통해 서버 코드에서만 사용합니다.
import 'dotenv/config';

const read = (name) => (process.env[name] ?? '').trim();
// 정수 설정값: 비어 있으면 기본값, 잘못된 값이면 경고 후 기본값
const int = (name, def) => {
  const raw = read(name).replace(/[_,]/g, '');
  if (raw === '') return def;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  console.warn(`⚠️  ${name}=${raw} 은(는) 올바른 정수가 아니어서 기본값 ${def}을(를) 사용합니다.`);
  return def;
};

export const env = {
  port: Number(read('PORT')) || 3000,
  // 기본은 내 컴퓨터에서만 접속 가능. 같은 네트워크에 공개하려면 HOST=0.0.0.0 (권장하지 않음)
  host: read('HOST') || '127.0.0.1',

  // ── 비용 통제 한도 (0 = 해당 기능 차단) ──────────────
  limits: {
    dailyPlans: int('DAILY_PLAN_LIMIT', 30), // 하루 일정 생성 횟수
    dailyTokens: int('DAILY_TOKEN_LIMIT', 1_000_000), // 하루 OpenAI 토큰(입력+출력)
    tokensPerRun: int('MAX_TOKENS_PER_RUN', 80_000), // 일정 1회 생성당 토큰
    webSearchPerRun: int('MAX_WEB_SEARCH_PER_RUN', 2), // 1회 생성당 web_search 호출
    dailyWebSearch: int('DAILY_WEB_SEARCH_LIMIT', 30), // 하루 web_search 호출
    dailySearch: int('DAILY_SEARCH_LIMIT', 500), // 하루 NAVER 지역 검색
    dailyDirections: int('DAILY_DIRECTIONS_LIMIT', 500), // 하루 NAVER 길찾기
    concurrentPlans: int('MAX_CONCURRENT_PLANS', 1), // 동시에 실행되는 Agent 수
    plansPerIpPer10Min: int('PLAN_RATE_LIMIT_PER_10MIN', 5), // IP별 10분당 일정 생성
    searchPerIpPerMin: int('SEARCH_RATE_LIMIT_PER_MIN', 20), // IP별 1분당 장소 검색
  },
  openai: {
    apiKey: read('OPENAI_API_KEY'),
    model: read('OPENAI_MODEL'),
    // 내장 web_search 사용 여부 (기본 on, 끄려면 OPENAI_WEB_SEARCH=off)
    webSearch: !/^(off|false|0|no)$/i.test(read('OPENAI_WEB_SEARCH')),
  },
  naverSearch: {
    clientId: read('NAVER_API_HUB_CLIENT_ID'),
    clientSecret: read('NAVER_API_HUB_CLIENT_SECRET'),
  },
  naverMaps: {
    clientId: read('NAVER_MAPS_CLIENT_ID'),
    clientSecret: read('NAVER_MAPS_CLIENT_SECRET'),
  },
};

// 브라우저에 내려도 되는 값만 모아 둡니다. (Secret/키는 절대 추가하지 마세요)
export const publicConfig = {
  naverMapsClientId: env.naverMaps.clientId,
};

const REQUIRED = {
  OPENAI_API_KEY: env.openai.apiKey,
  OPENAI_MODEL: env.openai.model,
  NAVER_API_HUB_CLIENT_ID: env.naverSearch.clientId,
  NAVER_API_HUB_CLIENT_SECRET: env.naverSearch.clientSecret,
  NAVER_MAPS_CLIENT_ID: env.naverMaps.clientId,
  NAVER_MAPS_CLIENT_SECRET: env.naverMaps.clientSecret,
};

const looksUnset = (v) => !v || /^사용할|^your[_-]|^<|^xxx/i.test(v);

export function missingEnv() {
  return Object.entries(REQUIRED)
    .filter(([, v]) => looksUnset(v))
    .map(([k]) => k);
}

// `npm run check:env` — 값 자체는 출력하지 않고 설정 여부만 보여 줍니다.
if (process.argv.includes('--check')) {
  for (const [k, v] of Object.entries(REQUIRED)) {
    console.log(`${looksUnset(v) ? '✗' : '✓'} ${k}`);
  }
  process.exit(missingEnv().length ? 1 : 0);
}
