// 일일 사용량 한도 + 동시 실행 제한 (과금 폭주 방지)
// - 날짜(한국 시간) 기준 카운터. 저장소는 store.js (Redis 또는 메모리/파일)
// - 한도를 넘으면 외부 API 를 호출하기 "전에" 차단합니다.
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { store } from './store.js';

const LIMIT_OF = {
  plans: () => env.limits.dailyPlans,
  tokens: () => env.limits.dailyTokens,
  webSearch: () => env.limits.dailyWebSearch,
  naverSearch: () => env.limits.dailySearch,
  naverDirections: () => env.limits.dailyDirections,
};
const LABEL = {
  plans: '일정 생성',
  tokens: 'OpenAI 토큰',
  webSearch: '웹 검색',
  naverSearch: 'NAVER 지역 검색',
  naverDirections: 'NAVER 길찾기',
};

const DAY_TTL = 2 * 24 * 60 * 60; // 이틀 뒤 자동 삭제
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const keyOf = (name) => `usage:${today()}:${name}`;

const limitError = (name) =>
  new HttpError(429, `오늘의 ${LABEL[name]} 한도(${LIMIT_OF[name]().toLocaleString()})에 도달했습니다. 내일 다시 이용하거나 한도 설정을 조정해 주세요.`);

// 저장소 장애 시: 비용 보호를 위해 "차단" 쪽으로 동작 (fail-closed)
async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[usage]', err.message);
    throw new HttpError(503, '사용량 확인에 실패해 요청을 중단했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

export const used = (name) => safe(() => store.get(keyOf(name)));

export async function remaining(name) {
  return Math.max(0, LIMIT_OF[name]() - (await used(name)));
}

/** 외부 API 호출 전 확인 (기록하지 않음) */
export async function assertAvailable(name, amount = 1) {
  if ((await used(name)) + amount > LIMIT_OF[name]()) throw limitError(name);
}

/** 실제 사용량 기록 */
export function record(name, amount = 1) {
  if (amount <= 0) return Promise.resolve();
  return safe(() => store.incr(keyOf(name), amount, DAY_TTL));
}

/** 확인 + 기록 (원자적: 먼저 올리고, 넘으면 되돌림) */
export async function consume(name, amount = 1) {
  await safe(async () => {
    const value = await store.incr(keyOf(name), amount, DAY_TTL);
    if (value > LIMIT_OF[name]()) {
      await store.incr(keyOf(name), -amount, DAY_TTL);
      throw limitError(name);
    }
  });
}

export async function usageSummary() {
  const names = Object.keys(LIMIT_OF);
  const values = await safe(() => store.getMany(names.map(keyOf)));
  return Object.fromEntries(names.map((k, i) => [k, { used: values[i], limit: LIMIT_OF[k]() }]));
}

export const storeKind = () => store.kind;

// ── 동시 실행 제한 ─────────────────────────────
// 서버리스에서 함수가 비정상 종료되면 카운터가 남을 수 있어 10분 TTL 로 자동 해제
const RUNNING_KEY = 'plans:running';
const RUNNING_TTL = 10 * 60;

/** Agent 실행 슬롯 확보. 반환된 release() 를 반드시 호출해야 합니다. */
export async function acquirePlanSlot() {
  await safe(async () => {
    const n = await store.incr(RUNNING_KEY, 1, RUNNING_TTL);
    if (n > env.limits.concurrentPlans) {
      await store.incr(RUNNING_KEY, -1, RUNNING_TTL);
      throw new HttpError(429, '다른 일정이 생성되고 있어요. 잠시 후 다시 시도해 주세요.');
    }
  });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try { await store.incr(RUNNING_KEY, -1, RUNNING_TTL); } catch (err) { console.error('[usage] 슬롯 해제 실패:', err.message); }
  };
}
