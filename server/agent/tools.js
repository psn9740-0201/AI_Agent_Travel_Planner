// Agent Tool 정의(스키마) + 실제 실행 함수
// - LLM 은 스키마만 보고 필요한 Tool 을 골라 호출합니다.
// - 실제 데이터(장소·좌표·이동시간·통행료·유류비)는 모두 외부 API 결과에서만 나옵니다.
import { search_places } from '../services/naverSearch.js';
import { getLegs } from '../services/naverMaps.js';
import { calculateBudget, COST_CATEGORIES } from './budget.js';

// ── 함수 스키마 (Responses API: type=function, strict) ─────────
export const FUNCTION_TOOLS = [
  {
    type: 'function',
    name: 'search_places',
    description:
      'NAVER 지역 검색으로 실제 장소(관광지·음식점·카페·숙소 등)를 찾습니다. 한 번에 최대 5곳. ' +
      '결과의 placeId 로만 일정에 장소를 넣을 수 있습니다. 영업시간·평점·가격은 제공하지 않습니다.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        region: { type: 'string', description: '여행 지역 (예: 강릉)' },
        keyword: { type: 'string', description: '검색 키워드 (예: 순두부 맛집, 오션뷰 카페, 박물관)' },
        sort: { type: 'string', enum: ['comment', 'random'], description: 'comment=리뷰 많은 순, random=정확도 순' },
      },
      required: ['region', 'keyword', 'sort'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_routes',
    description:
      'NAVER Directions 5 로 하루 일정의 장소들을 순서대로 이었을 때 구간별 자동차 이동 거리·시간·통행료·유류비를 조회합니다. 그날의 방문 순서를 정한 뒤 호출하세요. ' +
      '좌표는 search_places 의 placeId 로 서버가 찾습니다. 대중교통 경로는 제공하지 않습니다(자동차 기준).',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        day: { type: 'integer', description: '일차 (1부터)' },
        place_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '방문 순서대로의 placeId 목록 (2~8개)',
        },
      },
      required: ['day', 'place_ids'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'calculate_budget',
    description:
      '사용자의 총예산을 점검합니다. get_routes 로 확인된 유류비·통행료와, 출처가 있는 비용(web_search 로 확인한 입장료 등)만 확정 비용으로 합산하고, ' +
      '남은 예산을 항목별 권장 한도로 나눕니다. known_costs 의 source 는 web_search 로 확인한 URL이어야 하며, 그렇지 않으면 서버가 제외합니다.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        include_route_costs: { type: 'boolean', description: 'get_routes 로 조회한 유류비·통행료를 포함할지' },
        known_costs: {
          type: 'array',
          description: '출처가 확인된 비용만. 없으면 빈 배열',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: COST_CATEGORIES },
              label: { type: 'string', description: '예: 오죽헌 입장료' },
              amount_per_person: { type: 'integer', description: '1인 금액(원)' },
              source: { type: 'string', description: 'web_search 로 확인한 출처 URL' },
            },
            required: ['category', 'label', 'amount_per_person', 'source'],
            additionalProperties: false,
          },
        },
      },
      required: ['include_route_costs', 'known_costs'],
      additionalProperties: false,
    },
  },
];

// OpenAI 내장 웹 검색 (최신 축제·행사·휴무·운영 정보용)
export const WEB_SEARCH_TOOL = { type: 'web_search', search_context_size: 'low', user_location: { type: 'approximate', country: 'KR' } };

// ── Agent 실행 컨텍스트 ─────────────────────────────
// 요청 1건 동안 Tool 결과를 보관합니다. 최종 일정은 여기 있는 데이터로만 채웁니다.
export function createContext(trip) {
  return {
    trip,
    places: new Map(), // placeId → place
    searches: [], // search_places 호출 기록 (출처 표시용)
    placeKeys: new Map(), // name|address → placeId (중복 제거)
    routes: {}, // day → get_routes 결과 (마지막 호출 기준)
    budget: null, // 마지막 calculate_budget 결과
    budgetInput: null,
    webSources: new Map(), // url → title (이번 실행에서 web_search 로 실제 확인한 출처)
  };
}

function registerPlace(ctx, p, query) {
  const key = `${p.name}|${p.roadAddress || p.address}`;
  if (ctx.placeKeys.has(key)) return ctx.places.get(ctx.placeKeys.get(key));
  const placeId = `P${ctx.places.size + 1}`;
  const place = { placeId, ...p, sourceQuery: query };
  ctx.places.set(placeId, place);
  ctx.placeKeys.set(key, placeId);
  return place;
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const fmtMin = (ms) => Math.max(1, Math.round(ms / 60000));
const km = (m) => Math.round(m / 100) / 10;

// ── 실행 함수: { result(LLM에 전달), summary(Trace 표시용) } ──────
const executors = {
  async search_places(ctx, { region, keyword, sort }) {
    const r = await search_places({ region: region || ctx.trip.region, keyword, sort });
    const places = r.items.map((p) => registerPlace(ctx, p, r.query));
    ctx.searches.push({ query: r.query, count: places.length, cached: Boolean(r.cached) });
    return {
      result: {
        query: r.query,
        count: places.length,
        places: places.map((p) => ({
          placeId: p.placeId,
          name: p.name,
          category: p.category,
          address: p.roadAddress || p.address,
          hasCoordinates: p.lat !== null,
        })),
      },
      summary: places.length
        ? `'${r.query}' ${places.length}곳: ${places.map((p) => `${p.name}(${p.placeId})`).join(', ')}`
        : `'${r.query}' 결과 없음`,
    };
  },

  async get_routes(ctx, { day, place_ids }) {
    const ids = [...new Set(place_ids)].slice(0, 8);
    const unknown = ids.filter((id) => !ctx.places.has(id));
    const points = ids.map((id) => ctx.places.get(id)).filter((p) => p && p.lat !== null);
    if (points.length < 2) {
      throw new Error(`경로를 계산할 수 있는 장소가 2곳 미만입니다${unknown.length ? ` (알 수 없는 placeId: ${unknown.join(', ')})` : ''}.`);
    }
    const legs = await getLegs(points.map((p) => ({ id: p.placeId, name: p.name, lat: p.lat, lng: p.lng })));
    const okLegs = legs.filter((l) => l.ok);
    const total = okLegs.reduce(
      (t, l) => ({ distanceM: t.distanceM + l.distanceM, durationMs: t.durationMs + l.durationMs, tollFare: t.tollFare + l.tollFare, fuelPrice: t.fuelPrice + l.fuelPrice }),
      { distanceM: 0, durationMs: 0, tollFare: 0, fuelPrice: 0 },
    );
    ctx.routes[day] = { day, legs, total };
    return {
      result: {
        day,
        mode: '자동차(NAVER Directions 5, 실시간 교통 반영)',
        legs: legs.map((l) => (l.ok
          ? { from: l.from, to: l.to, distanceKm: km(l.distanceM), durationMin: fmtMin(l.durationMs), tollFare: l.tollFare, fuelPrice: l.fuelPrice }
          : { from: l.from, to: l.to, error: l.error })),
        total: { distanceKm: km(total.distanceM), durationMin: fmtMin(total.durationMs), tollFare: total.tollFare, fuelPrice: total.fuelPrice },
        ...(unknown.length ? { ignoredPlaceIds: unknown } : {}),
      },
      summary: `Day ${day} ${okLegs.length}/${legs.length}구간 · ${km(total.distanceM)}km · ${fmtMin(total.durationMs)}분` +
        (total.tollFare ? ` · 통행료 ${total.tollFare.toLocaleString()}원` : '') +
        ` · 유류비 ${total.fuelPrice.toLocaleString()}원`,
    };
  },

  async calculate_budget(ctx, { include_route_costs, known_costs }) {
    // 출처 검증: 이번 실행의 web_search 에서 실제로 확인된 URL(같은 도메인)만 인정합니다.
    const hosts = new Set([...ctx.webSources.keys()].map(hostOf).filter(Boolean));
    const accepted = [];
    const rejected = [];
    for (const c of known_costs) {
      const h = hostOf(c.source);
      if (h && hosts.has(h)) accepted.push(c);
      else rejected.push({ label: c.label, reason: 'web_search 로 확인된 출처 URL이 아니므로 제외' });
    }
    const b = calculateBudget(ctx.trip, { routes: include_route_costs ? ctx.routes : {}, knownCosts: accepted });
    ctx.budget = b;
    ctx.budgetInput = { includeRouteCosts: include_route_costs, knownCosts: accepted }; // 경로가 바뀌면 재계산용
    return {
      result: { ...b, ...(rejected.length ? { rejectedCosts: rejected } : {}) },
      summary: `확인된 비용 ${b.verifiedTotal.toLocaleString()}원 / 총예산 ${b.totalBudget.toLocaleString()}원 · 남은 예산 ${b.remaining.toLocaleString()}원` +
        (rejected.length ? ` · 출처 미확인 ${rejected.length}건 제외` : ''),
    };
  },
};

/** Tool 실행 (오류도 LLM 이 대응할 수 있도록 결과로 돌려줌) */
export async function runTool(ctx, name, rawArgs) {
  const exec = executors[name];
  if (!exec) return { ok: false, result: { error: `알 수 없는 도구: ${name}` }, summary: `알 수 없는 도구 ${name}` };
  let args;
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return { ok: false, args: rawArgs, result: { error: '인자 JSON 형식 오류' }, summary: '인자 JSON 형식 오류' };
  }
  try {
    const { result, summary } = await exec(ctx, args);
    return { ok: true, args, result, summary };
  } catch (err) {
    return { ok: false, args, result: { error: err.message }, summary: err.message };
  }
}
