// calculate_budget — 결정적(deterministic) 예산 계산
// 확정 비용: NAVER 길찾기의 유류비·통행료 + LLM 이 출처와 함께 전달한 비용만.
// 나머지는 "실제 가격"이 아니라 사용자의 남은 예산을 나눈 "권장 한도"로만 제공합니다.

export const COST_CATEGORIES = ['숙박', '식비', '입장·체험', '교통', '쇼핑', '기타'];

// 남은 예산 권장 배분 비율 (가격 추정이 아닌 예산 분배 규칙)
const SPLIT_WITH_STAY = { 숙박: 0.45, 식비: 0.33, '입장·체험': 0.12, 기타: 0.1 };
const SPLIT_DAY_TRIP = { 식비: 0.55, '입장·체험': 0.25, 기타: 0.2 };

export function calculateBudget(trip, { routes = {}, knownCosts = [] } = {}) {
  const nights = trip.days - 1;
  const verified = [];

  // 1) 길찾기 결과 (차량 1대 기준 — 인원수와 무관)
  const dayRoutes = Object.values(routes);
  if (dayRoutes.length) {
    const fuel = dayRoutes.reduce((s, r) => s + r.total.fuelPrice, 0);
    const toll = dayRoutes.reduce((s, r) => s + r.total.tollFare, 0);
    const days = dayRoutes.map((r) => `Day ${r.day}`).join(', ');
    verified.push({ category: '교통', label: `현지 이동 유류비 (${days})`, amount: fuel, source: 'NAVER Directions 5' });
    if (toll) verified.push({ category: '교통', label: `현지 이동 통행료 (${days})`, amount: toll, source: 'NAVER Directions 5' });
  }

  // 2) 출처가 있는 비용만 (1인 금액 × 인원)
  for (const c of knownCosts) {
    const amount = Math.round(Number(c.amount_per_person)) * trip.people;
    if (!c.source?.trim() || !Number.isFinite(amount) || amount < 0) continue;
    verified.push({ category: COST_CATEGORIES.includes(c.category) ? c.category : '기타', label: c.label, amount, perPerson: Math.round(c.amount_per_person), source: c.source.trim() });
  }

  const verifiedTotal = verified.reduce((s, v) => s + v.amount, 0);
  const remaining = trip.budget - verifiedTotal;

  // 3) 남은 예산 권장 배분
  const split = nights > 0 ? SPLIT_WITH_STAY : SPLIT_DAY_TRIP;
  const allocation = remaining > 0
    ? Object.entries(split).map(([category, ratio]) => {
      const amount = Math.floor((remaining * ratio) / 1000) * 1000;
      const row = { category, amount, perPerson: Math.floor(amount / trip.people / 100) * 100 };
      if (category === '숙박') row.perNight = Math.floor(amount / nights / 1000) * 1000;
      if (category === '식비') row.perPersonPerDay = Math.floor(amount / trip.people / trip.days / 100) * 100;
      return row;
    })
    : [];

  const notes = [
    '권장 배분은 실제 가격이 아니라 남은 예산을 나눈 한도입니다.',
    '장거리 왕복 교통비(집↔여행지)와 주차비는 포함되지 않았습니다.',
  ];
  if (!dayRoutes.length) notes.push('길찾기(get_routes) 결과가 없어 현지 유류비·통행료가 빠져 있습니다.');
  if (trip.transport === 'transit') notes.push('대중교통 여행이므로 자동차 유류비는 참고용입니다.');

  return {
    totalBudget: trip.budget,
    people: trip.people,
    days: trip.days,
    nights,
    verifiedCosts: verified,
    verifiedTotal,
    remaining,
    overBudget: remaining < 0,
    allocation,
    notes,
  };
}
