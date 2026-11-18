// Function Calling 기반 여행 계획 Agent (OpenAI Responses API)
//
//  ┌────────────── Agent Loop (최대 MAX_TURNS) ───────────────┐
//  │ LLM 호출 (tools: search_places, get_routes,              │
//  │           calculate_budget, web_search)                  │
//  │   ├─ function_call 있음 → Node 에서 실행 → 결과를 LLM 에 │
//  │   └─ function_call 없음 → 루프 종료                      │
//  └──────────────────────────────────────────────────────────┘
//  → 최종 정리 호출 (도구 없음, JSON 스키마) → 서버가 Tool 결과로 장소·경로·예산 채움
//
// onEvent(evt) 로 진행 상황(Trace)을 실시간 전달합니다.
import OpenAI from 'openai';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { AGENT_INSTRUCTIONS, FINAL_INSTRUCTIONS, buildFinalSchema, buildUserPrompt } from '../prompts/travelPlan.js';
import { FUNCTION_TOOLS, WEB_SEARCH_TOOL, createContext, runTool } from './tools.js';
import { calculateBudget } from './budget.js';
import { assertAvailable, record, remaining } from '../security/usageGuard.js';

export const LIMITS = {
  MAX_TURNS: 12, // LLM 판단(도구 선택) 최대 반복
  MAX_TOOL_CALLS: 24, // 함수 실행 총 횟수
  MAX_CONSECUTIVE_FAILS: 5, // 연속 도구 실패 허용
  MAX_OUTPUT_TOKENS_LOOP: 2_000, // Agent Loop 1회 응답 출력 상한
  MAX_OUTPUT_TOKENS_FINAL: 4_000, // 최종 JSON 출력 상한
};

let client;
function getClient() {
  if (!env.openai.apiKey) throw new HttpError(500, 'OPENAI_API_KEY가 .env에 설정되지 않았습니다.');
  if (!env.openai.model) throw new HttpError(500, 'OPENAI_MODEL이 .env에 설정되지 않았습니다.');
  if (!client) client = new OpenAI({ apiKey: env.openai.apiKey, timeout: 90_000, maxRetries: 2 });
  return client;
}

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err?.name === 'AbortError' || err instanceof OpenAI.APIUserAbortError) return new HttpError(499, '요청이 취소되었습니다.');
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new HttpError(504, 'AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
  if (err instanceof OpenAI.APIConnectionError) return new HttpError(502, 'OpenAI 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.');
  if (err instanceof OpenAI.APIError) {
    console.error(`[openai] ${err.status} ${err.code ?? ''} ${err.message}`);
    switch (err.status) {
      case 401: return new HttpError(502, 'OpenAI API 키가 올바르지 않습니다. 서버의 .env를 확인해 주세요.');
      case 403: return new HttpError(502, '이 API 키로는 해당 모델 또는 도구를 사용할 수 없습니다.');
      case 404: return new HttpError(502, `모델 '${env.openai.model}'을(를) 찾을 수 없습니다. OPENAI_MODEL을 확인해 주세요.`);
      case 429: return new HttpError(429, err.code === 'insufficient_quota' ? 'OpenAI 크레딧(사용 한도)이 부족합니다.' : '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
      case 400: return new HttpError(502, `AI 요청이 거부되었습니다: ${err.message}`);
      default: return new HttpError(502, 'AI 서비스에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }
  return err;
}

// 응답 메시지에서 웹 출처(url_citation) 수집
function collectCitations(response, sources, ctx) {
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      for (const a of c.annotations ?? []) {
        if (a.type === 'url_citation' && a.url) {
          ctx.webSources.set(a.url, a.title || a.url);
          if (!sources.some((s) => s.url === a.url)) sources.push({ title: a.title || a.url, url: a.url });
        }
      }
    }
  }
}

// NAVER 카테고리로 숙박 시설 판별
export const isLodging = (p) => /호텔|숙박|리조트|펜션|모텔|게스트하우스|콘도|민박|호스텔|스테이|여관/.test(p.category ?? '');

// 일정 구성에 필요한 검색이 부족한지 점검 (도구 순서를 강제하지 않고, 부족한 점만 LLM 에 알려 줌)
function coverageGap(ctx) {
  const all = [...ctx.places.values()];
  const spots = all.filter((p) => !isLodging(p)).length;
  const need = Math.min(ctx.trip.days * 4, 12);
  const gaps = [];
  if (spots < need) gaps.push(`일정에 넣을 관광지·식당·카페 후보가 ${spots}곳뿐입니다(최소 ${need}곳 필요). 사용자 취향에 맞는 키워드로 search_places 를 더 호출하세요.`);
  if (ctx.trip.days > 1 && !all.some(isLodging)) gaps.push('1박 이상 여행이지만 숙소 후보가 없습니다. search_places 로 숙소를 검색하세요.');
  return gaps;
}

// 최종 정리 단계에 제공할 장소 목록
function placeCatalog(ctx) {
  return [...ctx.places.values()]
    .map((p) => `${p.placeId} | ${p.name} | ${p.categoryShort}${isLodging(p) ? ' (숙소)' : ''} | ${p.roadAddress || p.address}`)
    .join('\n');
}

const hhmm = (s) => (/^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, '0') : '');

// 최종 JSON(placeId 참조) → 화면용 일정. 장소·좌표·이동 정보는 Tool 결과에서만 가져옵니다.
function assemblePlan(ctx, draft, warnings) {
  const { places, routes, trip } = ctx;
  const lodging = draft.lodgingPlaceId && places.get(draft.lodgingPlaceId);
  if (draft.lodgingPlaceId && !lodging) warnings.push(`숙소 placeId '${draft.lodgingPlaceId}'가 검색 결과에 없어 제외했습니다.`);

  const used = new Set();
  const days = draft.days.slice(0, trip.days).map((d, i) => {
    const items = [];
    for (const it of d.items) {
      const p = places.get(it.placeId);
      if (!p) {
        warnings.push(`Day ${i + 1}: 검색 결과에 없는 장소${it.placeId ? `(${it.placeId})` : ''}는 제외했습니다.`);
        continue;
      }
      if (isLodging(p)) continue; // 숙소는 lodging 으로만 표시
      if (used.has(p.placeId)) {
        warnings.push(`Day ${i + 1}: '${p.name}'이(가) 중복되어 한 번만 넣었습니다.`);
        continue;
      }
      used.add(p.placeId);
      items.push({
        time: hhmm(it.time), placeId: p.placeId, name: p.name, category: it.category,
        naverCategory: p.categoryShort, address: p.roadAddress || p.address,
        lat: p.lat, lng: p.lng, link: p.link, description: it.description, reason: it.reason,
        source: { api: 'NAVER 지역 검색', query: p.sourceQuery },
      });
    }
    if (lodging && i < trip.days - 1) {
      items.push({
        time: '', placeId: lodging.placeId, name: lodging.name, category: '숙소', naverCategory: lodging.categoryShort,
        address: lodging.roadAddress || lodging.address, lat: lodging.lat, lng: lodging.lng, link: lodging.link,
        description: '', reason: draft.lodgingNote,
        source: { api: 'NAVER 지역 검색', query: lodging.sourceQuery },
      });
    }
    // 이동 정보: get_routes 결과에서 정확히 같은 구간이 있을 때만 붙입니다.
    const legs = routes[i + 1]?.legs ?? [];
    items.forEach((p, k) => {
      const next = items[k + 1];
      const leg = next && legs.find((l) => l.ok && l.fromId === p.placeId && l.toId === next.placeId);
      p.move = leg ? { distanceM: leg.distanceM, durationMs: leg.durationMs, tollFare: leg.tollFare, fuelPrice: leg.fuelPrice, path: leg.path ?? [] } : null;
    });
    return { day: i + 1, theme: d.theme, items, routeChecked: Boolean(routes[i + 1]) };
  });

  // calculate_budget 이후 get_routes 가 다시 호출됐을 수 있으므로, 같은 입력으로 최신 경로 기준 재계산
  // (LLM 이 넘긴 비용 항목은 그대로, 유류비·통행료만 마지막 NAVER 길찾기 결과로 갱신)
  if (ctx.budgetInput) {
    ctx.budget = calculateBudget(trip, { routes: ctx.budgetInput.includeRouteCosts ? routes : {}, knownCosts: ctx.budgetInput.knownCosts });
  }

  return {
    title: draft.title,
    summary: draft.summary,
    tips: draft.tips,
    days,
    lodging: lodging ? { name: lodging.name, address: lodging.roadAddress || lodging.address, note: draft.lodgingNote } : null,
    budget: ctx.budget,
    searches: ctx.searches,
  };
}

/**
 * @param {object} trip 검증된 여행 조건
 * @param {{ onEvent?: (e:object)=>void, signal?: AbortSignal }} opts
 */
export async function runTravelAgent(trip, { onEvent = () => {}, signal } = {}) {
  const openai = getClient();
  const ctx = createContext(trip);
  const usage = { inputTokens: 0, outputTokens: 0 };
  const sources = [];
  const warnings = [];
  const toolCounts = {};
  const started = Date.now();
  let toolCalls = 0;
  let consecutiveFails = 0;
  let stopReason = 'done';

  const call = async (params) => {
    if (signal?.aborted) throw new HttpError(499, '요청이 취소되었습니다.');
    await assertAvailable('tokens'); // 오늘 토큰 한도를 이미 다 썼으면 호출하지 않음
    try {
      const res = await openai.responses.create({ model: env.openai.model, ...params }, { signal });
      const inT = res.usage?.input_tokens ?? 0;
      const outT = res.usage?.output_tokens ?? 0;
      usage.inputTokens += inT;
      usage.outputTokens += outT;
      await record('tokens', inT + outT);
      return res;
    } catch (err) {
      throw toHttpError(err);
    }
  };

  let webSearches = 0;
  // web_search 는 건당 과금되므로 1회 실행·하루 한도 안에서만 도구 목록에 넣습니다.
  const webSearchLeft = async () => (env.openai.webSearch ? Math.min(env.limits.webSearchPerRun - webSearches, await remaining('webSearch')) : 0);
  const toolsFor = (webLeft) => [...FUNCTION_TOOLS, ...(webLeft > 0 ? [WEB_SEARCH_TOOL] : [])];
  const runTokens = () => usage.inputTokens + usage.outputTokens;

  onEvent({ type: 'start', tools: toolsFor(await webSearchLeft()).map((t) => t.name ?? t.type), limits: { ...LIMITS, MAX_TOKENS_PER_RUN: env.limits.tokensPerRun, MAX_WEB_SEARCH_PER_RUN: env.limits.webSearchPerRun } });

  // ── Agent Loop ─────────────────────────────
  let response;
  let pendingOutputs = []; // 다음 턴에 전달할 function_call_output
  let nudges = 0; // 검색 부족 안내 횟수
  for (let turn = 1; turn <= LIMITS.MAX_TURNS; turn++) {
    onEvent({ type: 'thinking', turn });
    const t0 = Date.now();
    const webAllowed = await webSearchLeft();
    const tools = toolsFor(webAllowed);
    response = await call({
      instructions: AGENT_INSTRUCTIONS,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      max_output_tokens: LIMITS.MAX_OUTPUT_TOKENS_LOOP,
      ...(webAllowed > 0 ? { max_tool_calls: webAllowed, include: ['web_search_call.action.sources'] } : {}),
      ...(response
        ? { previous_response_id: response.id, input: pendingOutputs }
        : { input: [{ role: 'user', content: buildUserPrompt(trip) }] }),
    });
    pendingOutputs = [];
    collectCitations(response, sources, ctx);

    const fnCalls = response.output.filter((o) => o.type === 'function_call');
    const webCalls = response.output.filter((o) => o.type === 'web_search_call');
    onEvent({
      type: 'model', turn, durationMs: Date.now() - t0,
      tokens: { input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0 },
      decision: fnCalls.length || webCalls.length
        ? [...webCalls.map(() => 'web_search'), ...fnCalls.map((c) => c.name)]
        : 'answer',
    });

    // 내장 web_search 는 OpenAI 쪽에서 실행되므로 결과만 Trace 에 남깁니다.
    if (webCalls.length) {
      webSearches += webCalls.length;
      await record('webSearch', webCalls.length);
    }
    for (const w of webCalls) {
      toolCounts.web_search = (toolCounts.web_search ?? 0) + 1;
      const q = w.action?.query ?? w.action?.queries?.join(', ') ?? '';
      const found = w.action?.sources?.length ?? 0;
      for (const s of w.action?.sources ?? []) if (s.url) ctx.webSources.set(s.url, s.title || s.url);
      onEvent({ type: 'web_search', status: w.status, query: q, summary: `${found ? `출처 ${found}개 확인` : '검색 완료'}${q ? ` · "${q}"` : ''}` });
    }

    // 1회 실행 토큰 상한: 넘으면 더 묻지 않고 지금까지 정보로 정리
    if (runTokens() >= env.limits.tokensPerRun) {
      stopReason = 'token_budget';
      for (const fc of fnCalls) pendingOutputs.push({ type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify({ error: '토큰 한도로 실행하지 않았습니다.' }) });
      break;
    }

    if (!fnCalls.length) {
      // LLM 이 도구 사용을 끝내려 할 때, 일정 구성에 필요한 정보가 부족하면 한 번 더 기회를 줍니다.
      const gaps = coverageGap(ctx);
      if (gaps.length && nudges < 2 && turn < LIMITS.MAX_TURNS) {
        nudges++;
        onEvent({ type: 'guard', message: gaps.join(' ') });
        pendingOutputs = [{ role: 'user', content: `[시스템 점검] ${gaps.join(' ')} 검색 후 일정이 바뀌면 get_routes 와 calculate_budget 도 바뀐 일정 기준으로 다시 호출하세요.` }];
        continue;
      }
      break; // LLM 이 더 이상 도구가 필요 없다고 판단
    }

    // 함수 실행 (병렬)
    const budgetLeft = LIMITS.MAX_TOOL_CALLS - toolCalls;
    const runnable = fnCalls.slice(0, Math.max(0, budgetLeft));
    const skipped = fnCalls.slice(runnable.length);
    toolCalls += runnable.length;

    const results = await Promise.all(runnable.map(async (fc) => {
      onEvent({ type: 'tool_call', callId: fc.call_id, name: fc.name, args: fc.arguments });
      const t1 = Date.now();
      const r = await runTool(ctx, fc.name, fc.arguments);
      toolCounts[fc.name] = (toolCounts[fc.name] ?? 0) + 1;
      onEvent({ type: 'tool_result', callId: fc.call_id, name: fc.name, ok: r.ok, summary: r.summary, durationMs: Date.now() - t1 });
      return { fc, r };
    }));

    for (const { fc, r } of results) {
      consecutiveFails = r.ok ? 0 : consecutiveFails + 1;
      pendingOutputs.push({ type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify(r.result) });
    }
    for (const fc of skipped) {
      pendingOutputs.push({ type: 'function_call_output', call_id: fc.call_id, output: JSON.stringify({ error: '최대 도구 호출 횟수를 초과해 실행하지 않았습니다.' }) });
    }

    if (skipped.length || toolCalls >= LIMITS.MAX_TOOL_CALLS) { stopReason = 'max_tool_calls'; break; }
    if (consecutiveFails >= LIMITS.MAX_CONSECUTIVE_FAILS) { stopReason = 'tool_failures'; break; }
    if (turn === LIMITS.MAX_TURNS) stopReason = 'max_turns';
  }

  if (stopReason !== 'done') {
    const msg = {
      max_turns: `최대 반복 횟수(${LIMITS.MAX_TURNS}회)에 도달해 지금까지 모은 정보로 일정을 정리했습니다.`,
      max_tool_calls: `최대 도구 호출 횟수(${LIMITS.MAX_TOOL_CALLS}회)에 도달해 지금까지 모은 정보로 일정을 정리했습니다.`,
      tool_failures: '도구 호출이 연속으로 실패해 지금까지 모은 정보로 일정을 정리했습니다.',
      token_budget: `1회 실행 토큰 한도(${env.limits.tokensPerRun.toLocaleString()})에 도달해 지금까지 모은 정보로 일정을 정리했습니다.`,
    }[stopReason];
    warnings.push(msg);
    onEvent({ type: 'limit', reason: stopReason, message: msg });
  }

  if (ctx.places.size === 0) {
    throw new HttpError(502, '장소 검색 결과가 없어 일정을 만들 수 없습니다. 지역명이나 조건을 바꿔 다시 시도해 주세요.');
  }

  // ── 최종 정리: 도구 없이 JSON 스키마로 출력 ─────────────
  onEvent({ type: 'finalizing' });
  const t2 = Date.now();
  const final = await call({
    previous_response_id: response.id,
    instructions: FINAL_INSTRUCTIONS,
    input: [
      ...pendingOutputs, // 아직 응답하지 않은 function_call 이 있으면 먼저 결과 전달
      {
        role: 'user',
        content: `지금까지의 결과로 최종 일정을 JSON 형식으로 작성해 주세요.\n` +
          `사용 가능한 장소 목록 (placeId | 이름 | 카테고리 | 주소):\n${placeCatalog(ctx)}\n` +
          '각 일정 항목의 placeId 는 description 에 적는 바로 그 장소여야 합니다. 같은 장소를 두 번 쓰지 말고, (숙소) 표시된 장소는 lodgingPlaceId 에만 쓰세요.',
      },
    ],
    max_output_tokens: LIMITS.MAX_OUTPUT_TOKENS_FINAL,
    text: { format: { type: 'json_schema', name: 'travel_plan', schema: buildFinalSchema(trip.days), strict: true } },
  });
  if (final.status === 'incomplete') throw new HttpError(502, `AI 응답이 중간에 끊겼습니다 (${final.incomplete_details?.reason ?? 'unknown'}).`);
  const refusal = final.output?.flatMap((o) => o.content ?? []).find((c) => c.type === 'refusal');
  if (refusal) throw new HttpError(422, `AI가 요청을 처리하지 않았습니다: ${refusal.refusal}`);

  let draft;
  try {
    draft = JSON.parse(final.output_text);
  } catch {
    throw new HttpError(502, 'AI 최종 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
  }
  onEvent({ type: 'finalized', durationMs: Date.now() - t2 });

  const plan = assemblePlan(ctx, draft, warnings);
  if (plan.days.every((d) => d.items.length === 0)) {
    throw new HttpError(502, '검색으로 확인된 장소로 일정을 구성하지 못했습니다. 다시 시도해 주세요.');
  }

  return {
    plan: { ...plan, sources },
    warnings,
    meta: {
      model: final.model,
      durationMs: Date.now() - started,
      usage,
      toolCalls,
      toolCounts,
      webSearches,
      stopReason,
      placesFound: ctx.places.size,
    },
  };
}
