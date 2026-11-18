// [Level 1] NAVER API HUB 지역 검색 — 서버 전용 (Client Secret 사용)
// 공식 문서: https://api.ncloud-docs.com/docs/naver-api-hub-search-local
//   GET https://naverapihub.apigw.ntruss.com/search/v1/local
//   헤더: X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY
//   파라미터: query(필수), display(1~5), start(1), sort(random|comment)
//   응답: items[].title, link, category, description, address, roadAddress, mapx, mapy (WGS84)
//
// ⚠️ API가 주는 값만 사용합니다. 영업시간·평점·가격 등은 제공되지 않으므로 만들지 않습니다.
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createCache } from '../security/cache.js';
import { consume } from '../security/usageGuard.js';

// 같은 검색어는 6시간 동안 재호출하지 않음 (과금·한도 절약)
const cache = createCache({ ttlMs: 6 * 60 * 60_000, max: 300 });

const LOCAL_SEARCH_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/local';
const MAX_DISPLAY = 5;

// 검색어 강조 태그(<b>)와 HTML 엔티티 제거
function stripHtml(s = '') {
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .trim();
}

// mapx/mapy → { lat, lng }
// 문서상 WGS84 이며, 실제 응답은 경위도에 10^7 을 곱한 정수 문자열입니다(예: "1269770162").
// 혹시 소수 형태(126.977)로 오더라도 처리할 수 있게 크기로 판별합니다.
export function parseCoord(mapx, mapy) {
  let lng = Number(mapx);
  let lat = Number(mapy);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng === 0 || lat === 0) return null;
  if (Math.abs(lng) > 180) lng /= 1e7;
  if (Math.abs(lat) > 90) lat /= 1e7;
  // 대한민국 범위를 벗어나면 잘못된 좌표로 간주
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
  return { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) };
}

export function normalizeItem(item) {
  const coord = parseCoord(item.mapx, item.mapy);
  const categoryPath = stripHtml(item.category);
  return {
    name: stripHtml(item.title),
    category: categoryPath,                                   // 예: "카페,디저트>카페"
    categoryShort: categoryPath.split('>').pop() || categoryPath,
    address: stripHtml(item.address),                         // 지번 주소
    roadAddress: stripHtml(item.roadAddress),                 // 도로명 주소
    lat: coord?.lat ?? null,
    lng: coord?.lng ?? null,
    link: item.link || '',
    description: stripHtml(item.description),
  };
}

function toHttpError(status, body) {
  const code = body?.errorCode ?? body?.error?.errorCode;
  const msg = body?.errorMessage ?? body?.error?.message ?? '';
  console.error(`[naver-search] ${status} ${code ?? ''} ${msg}`);
  switch (status) {
    case 401: return new HttpError(502, 'NAVER API HUB 인증에 실패했습니다. Client ID/Secret과 애플리케이션의 검색 API 권한을 확인해 주세요.');
    case 403: return new HttpError(502, 'NAVER API HUB 호출이 허용되지 않았습니다. 애플리케이션에 지역 검색 API가 등록되어 있는지 확인해 주세요.');
    case 429: return new HttpError(429, 'NAVER 검색 일일 호출 한도를 초과했습니다.');
    case 400: return new HttpError(400, `검색 요청이 올바르지 않습니다${code ? ` (${code})` : ''}.`);
    default: return new HttpError(502, `NAVER 지역 검색 중 오류가 발생했습니다 (${status}).`);
  }
}

/**
 * 지역 검색 원본 호출
 * @param {string} query 검색어 (예: "강릉 카페")
 * @param {{ display?: number, sort?: 'random'|'comment' }} [opts]
 */
export async function searchPlaces(query, { display = MAX_DISPLAY, sort = 'random' } = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw new HttpError(400, '검색어가 비어 있습니다.');
  if (!env.naverSearch.clientId || !env.naverSearch.clientSecret) {
    throw new HttpError(500, 'NAVER_API_HUB_CLIENT_ID / NAVER_API_HUB_CLIENT_SECRET이 .env에 설정되지 않았습니다.');
  }

  const cacheKey = `${q}|${display}|${sort}`;
  const cached = cache.get(cacheKey);
  if (cached) return { ...cached, cached: true };
  await consume('naverSearch'); // 한도 초과 시 여기서 429 (외부 호출 전)

  const params = new URLSearchParams({
    query: q,
    display: String(Math.min(MAX_DISPLAY, Math.max(1, Number(display) || MAX_DISPLAY))),
    start: '1',
    sort: sort === 'comment' ? 'comment' : 'random',
  });

  let res;
  try {
    res = await fetch(`${LOCAL_SEARCH_URL}?${params}`, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': env.naverSearch.clientId,
        'X-NCP-APIGW-API-KEY': env.naverSearch.clientSecret,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new HttpError(504, err.name === 'TimeoutError'
      ? 'NAVER 지역 검색 응답 시간이 초과되었습니다.'
      : 'NAVER 지역 검색 서버에 연결하지 못했습니다.');
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) throw toHttpError(res.status, body);

  const items = (body?.items ?? []).map(normalizeItem);
  const result = { query: q, total: body?.total ?? items.length, items };
  cache.set(cacheKey, result);
  return result;
}

/**
 * search_places — 여행 지역 + 키워드로 장소 검색 (Level 2 Function Calling 에서 tool 로 재사용 예정)
 * @param {{ region: string, keyword: string, display?: number, sort?: 'random'|'comment' }} args
 */
export async function search_places({ region, keyword, display = MAX_DISPLAY, sort = 'comment' } = {}) {
  const r = String(region ?? '').trim();
  const k = String(keyword ?? '').trim();
  if (!r && !k) throw new HttpError(400, '여행 지역 또는 키워드를 입력해 주세요.');
  // 키워드에 이미 지역명이 들어 있으면 중복해서 붙이지 않습니다.
  const query = r && !k.includes(r) ? `${r} ${k}`.trim() : k || r;
  const result = await searchPlaces(query, { display, sort });
  return { region: r, keyword: k, ...result };
}
