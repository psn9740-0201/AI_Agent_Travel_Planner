// NAVER Cloud Platform Maps — Directions 5 (자동차 길찾기) — 서버 전용
// 공식 문서: https://api.ncloud-docs.com/docs/application-maps-directions5
//   GET https://maps.apigw.ntruss.com/map-direction/v1/driving?start=lng,lat&goal=lng,lat&option=trafast
//   헤더: x-ncp-apigw-api-key-id / x-ncp-apigw-api-key
//   summary: distance(m), duration(ms), tollFare(원), fuelPrice(원), taxiFare(원)
// 경유지별 구간 값은 summary 에 없으므로, 두 지점씩 따로 호출해 API가 준 값을 그대로 사용합니다.
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createCache } from '../security/cache.js';
import { consume } from '../security/usageGuard.js';

// 같은 구간은 30분 동안 재사용 (실시간 교통 반영 값이므로 짧게)
const cache = createCache({ ttlMs: 30 * 60_000, max: 1000 });

// 경로 좌표를 최대 maxPoints 개로 줄임 (시작·끝점 유지). [lng, lat] 배열
function simplifyPath(path = [], maxPoints = 150) {
  if (path.length <= maxPoints) return path;
  const step = (path.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => path[Math.round(i * step)]);
}

const DRIVING_URL = 'https://maps.apigw.ntruss.com/map-direction/v1/driving';

const ROUTE_CODE = {
  1: '출발지와 도착지가 같습니다.',
  2: '출발지 또는 도착지가 도로 주변이 아닙니다.',
  3: '자동차 길찾기 결과를 제공할 수 없습니다.',
  4: '경유지가 도로 주변이 아닙니다.',
  5: '요청 경로가 너무 깁니다(1,500km 이상).',
};

/**
 * 두 지점 사이 자동차 경로 요약
 * @param {{lat:number,lng:number}} from
 * @param {{lat:number,lng:number}} to
 * @returns {Promise<{distanceM:number, durationMs:number, tollFare:number, fuelPrice:number, taxiFare:number}>}
 */
export async function getDrivingSummary(from, to, { option = 'trafast' } = {}) {
  if (!env.naverMaps.clientId || !env.naverMaps.clientSecret) {
    throw new HttpError(500, 'NAVER_MAPS_CLIENT_ID / NAVER_MAPS_CLIENT_SECRET이 .env에 설정되지 않았습니다.');
  }
  const params = new URLSearchParams({ start: `${from.lng},${from.lat}`, goal: `${to.lng},${to.lat}`, option });
  const cacheKey = params.toString();
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  await consume('naverDirections'); // 한도 초과 시 여기서 429 (외부 호출 전)
  let res;
  try {
    res = await fetch(`${DRIVING_URL}?${params}`, {
      headers: {
        'x-ncp-apigw-api-key-id': env.naverMaps.clientId,
        'x-ncp-apigw-api-key': env.naverMaps.clientSecret,
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new HttpError(504, err.name === 'TimeoutError' ? '길찾기 응답 시간이 초과되었습니다.' : '길찾기 서버에 연결하지 못했습니다.');
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(502, 'NAVER Maps 인증에 실패했습니다. Maps Application에 Directions 5가 등록되어 있는지 확인해 주세요.');
  }
  if (res.status === 429) throw new HttpError(429, 'NAVER 길찾기 호출 한도를 초과했습니다.');
  if (body?.code !== 0) {
    throw new HttpError(400, ROUTE_CODE[body?.code] ?? `길찾기 실패 (HTTP ${res.status}${body?.code !== undefined ? `, code ${body.code}` : ''})`);
  }
  const s = body.route?.[option]?.[0]?.summary;
  if (!s) throw new HttpError(502, '길찾기 결과가 비어 있습니다.');
  const result = {
    distanceM: s.distance,
    durationMs: s.duration,
    tollFare: s.tollFare ?? 0,
    fuelPrice: s.fuelPrice ?? 0,
    taxiFare: s.taxiFare ?? 0,
    // 실제 자동차 경로 좌표 (지도 Polyline 용, LLM 에는 전달하지 않음)
    path: simplifyPath(body.route[option][0].path),
  };
  cache.set(cacheKey, result);
  return result;
}

/**
 * 여러 지점을 순서대로 잇는 구간별 경로 (구간마다 Directions 5 호출)
 * @param {Array<{id?:string,name?:string,lat:number,lng:number}>} points
 */
export async function getLegs(points) {
  const pairs = points.slice(0, -1).map((p, i) => [p, points[i + 1]]);
  return Promise.all(
    pairs.map(async ([a, b]) => {
      try {
        const s = await getDrivingSummary(a, b);
        return { fromId: a.id, toId: b.id, from: a.name, to: b.name, ok: true, ...s };
      } catch (err) {
        return { fromId: a.id, toId: b.id, from: a.name, to: b.name, ok: false, error: err.message };
      }
    }),
  );
}
