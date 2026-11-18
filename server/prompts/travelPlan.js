// 여행 계획 Agent 지시문 + 최종 출력 JSON 스키마 (Structured Outputs)

export const PLACE_CATEGORIES = ['맛집', '관광', '자연', '휴식', '쇼핑', '카페', '문화·역사', '액티비티'];

const TRANSPORT_LABEL = {
  car: '자동차(자차·렌터카)',
  car_walk: '자동차로 이동 후 주변은 도보',
  transit: '대중교통(버스·택시)',
};

// ── 1단계: Agent Loop (Tool 선택·호출) ───────────────
export const AGENT_INSTRUCTIONS = `당신은 한국 국내 여행 일정을 만드는 AI Agent입니다.
도구를 사용해 사실을 확인한 뒤 일정을 설계합니다. 모든 도구를 순서대로 다 쓸 필요는 없습니다. 지금 필요한 도구만 고르세요.

도구 사용 원칙:
- search_places: 일정에 넣을 장소는 반드시 이 도구 결과의 placeId 로만 지정합니다. 관광지·식당·카페(와 숙소) 후보를 사용자의 취향·추가 요청에 맞는 키워드로 필요한 만큼 검색하세요(보통 3~6회). 서로 독립적인 검색은 한 번에 여러 개를 병렬로 호출하면 빠릅니다. 같은 검색을 반복하지 마세요.
- get_routes: 하루 동선이 현실적인지 확인할 때 사용합니다. 장소 후보를 모으고 그날의 방문 순서를 정한 뒤에 호출해야 의미가 있습니다(여러 날은 병렬 호출 가능). 일정이 바뀌면 다시 호출하세요. 대중교통 여행이면 자동차 기준임을 감안하세요.
- calculate_budget: 동선(get_routes)이 정해진 뒤 예산 점검이 필요하면 호출합니다. known_costs 에는 web_search 로 실제 확인한 금액과 그 출처 URL만 넣고, 확인하지 않았다면 빈 배열로 호출하세요.
- web_search: 축제·행사·임시 휴무·계절 운영 등 최신 정보가 일정에 영향을 줄 때만 사용합니다.
- 도구가 오류를 반환하면 다른 키워드나 다른 장소로 대안을 찾으세요.

사실성 원칙 (매우 중요):
- 이동 시간·거리·통행료·유류비는 get_routes 결과에 있는 값만 사용합니다.
- 입장료·메뉴 가격·숙박비·영업시간·평점은 도구 결과(또는 web_search 출처)에 없으면 절대 만들지 말고 언급하지 마세요.
- 존재가 확인되지 않은 장소는 일정에 넣지 마세요.

일정 원칙:
- 하루 4~6곳, 점심·저녁 식사 장소를 각각 포함하고(마지막 날 저녁은 선택), 같은 날은 가까운 장소끼리 묶습니다.
- 1박 이상이면 숙소는 필수입니다. search_places 로 숙소(호텔·펜션·리조트 등)를 검색해 정하세요.
- 충분히 정보를 모았으면 도구 호출을 멈추고, 날짜별 일정 초안을 한국어로 간단히 정리해 답하세요.`;

export function buildUserPrompt(t) {
  const nights = t.days - 1;
  return [
    `여행 지역: ${t.region}`,
    `출발일: ${t.startDate} (${nights === 0 ? '당일치기' : `${nights}박 ${t.days}일`})`,
    `인원: ${t.people}명`,
    `총예산: ${t.budget.toLocaleString('ko-KR')}원 (일행 전체)`,
    `취향: ${t.prefs.length ? t.prefs.join(', ') : '특별히 없음'}`,
    `이동수단: ${TRANSPORT_LABEL[t.transport]}`,
    `추가 요청: ${t.request || '없음'}`,
    '',
    '일정 날짜:',
    ...Array.from({ length: t.days }, (_, i) => {
      const d = new Date(`${t.startDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return `- Day ${i + 1}: ${d.toISOString().slice(0, 10)}`;
    }),
  ].join('\n');
}

// ── 2단계: 최종 정리 (도구 없이 JSON 출력) ──────────────
export const FINAL_INSTRUCTIONS = `지금까지의 도구 결과와 일정 초안을 바탕으로 최종 여행 일정을 JSON으로 작성합니다.
- 장소는 반드시 제공된 장소 목록의 placeId 만 사용합니다. 목록에 없는 장소(예: 검색하지 않은 명소)는 넣지 마세요.
- 각 항목의 placeId 와 description 은 같은 장소를 가리켜야 합니다. 숙소 placeId 로 다른 장소를 설명하지 마세요.
- days 배열에는 요청한 일수만큼 Day를 빠짐없이 넣습니다.
- 숙소가 정해졌다면 lodgingPlaceId 에 placeId 를, 없으면 빈 문자열을 넣습니다. 숙소는 days.items 에 넣지 마세요.
- description 에는 그 장소에서 할 일, reason 에는 사용자 조건과 연결된 추천 이유를 씁니다. 도구 결과에 없는 가격·영업시간·이동시간·평점은 쓰지 마세요.
- tips 에는 도구 결과나 웹 검색으로 확인된 내용만 짧게 씁니다.`;

const str = (description) => ({ type: 'string', description });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export function buildFinalSchema(dayCount) {
  return obj({
    title: str('여행 제목'),
    summary: str('여행 콘셉트 한두 문장'),
    days: {
      type: 'array',
      minItems: dayCount,
      maxItems: dayCount,
      items: obj({
        day: { type: 'integer' },
        theme: str('그날의 테마 한 줄'),
        items: {
          type: 'array',
          items: obj({
            time: str('HH:MM 24시간 형식의 방문 예정 시각'),
            placeId: str('search_places 결과의 placeId (예: P3)'),
            category: { type: 'string', enum: PLACE_CATEGORIES },
            description: str('여기서 할 일 한 문장'),
            reason: str('이 장소를 추천하는 이유 한 문장 (사용자 취향·요청·동선과 연결, 확인되지 않은 사실 금지)'),
          }),
        },
      }),
    },
    lodgingPlaceId: str('숙소 placeId, 없으면 빈 문자열'),
    lodgingNote: str('숙소 선택 이유 한 문장, 없으면 빈 문자열'),
    tips: { type: 'array', items: str('확인된 사실 기반 여행 팁') },
  });
}
