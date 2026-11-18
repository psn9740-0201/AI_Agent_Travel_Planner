// ⚠️ 샘플 데이터 — 실제 API(Level 1~3) 연결 전까지 화면 확인용으로만 사용합니다.
// 좌표는 대략적인 위치이며, 비용은 1인 기준 추정치(원)입니다.
// 장소 형태: { time, name, category, desc, cost, lat, lng }

export const CATEGORY = {
  맛집: { color: 'var(--c-food)', emoji: '🍜' },
  관광: { color: 'var(--c-tour)', emoji: '📸' },
  자연: { color: 'var(--c-nature)', emoji: '🌿' },
  휴식: { color: 'var(--c-rest)', emoji: '🛀' },
  쇼핑: { color: 'var(--c-shop)', emoji: '🛍️' },
  카페: { color: 'var(--c-cafe)', emoji: '☕' },
  '문화·역사': { color: 'var(--c-culture)', emoji: '🏛️' },
  액티비티: { color: 'var(--c-activity)', emoji: '🏄' },
  숙소: { color: 'var(--c-stay)', emoji: '🛏️' },
};

const REGIONS = {
  강릉: {
    tagline: '바다와 커피, 순두부가 있는 동해 여행',
    lodging: { name: '경포 오션뷰 호텔', lat: 37.7985, lng: 128.9020, pricePerRoom: 130000 },
    days: [
      [
        { time: '11:00', name: '강릉중앙시장', category: '맛집', desc: '닭강정·장칼국수로 든든한 첫 끼', cost: 15000, lat: 37.7543, lng: 128.8996 },
        { time: '13:00', name: '오죽헌', category: '문화·역사', desc: '율곡 이이가 태어난 검은 대나무 고택', cost: 3000, lat: 37.7792, lng: 128.8784 },
        { time: '15:00', name: '안목해변 카페거리', category: '카페', desc: '바다를 보며 핸드드립 한 잔', cost: 9000, lat: 37.7720, lng: 128.9476 },
        { time: '17:30', name: '경포해변', category: '자연', desc: '노을 산책과 경포호 한 바퀴', cost: 0, lat: 37.8055, lng: 128.9087 },
        { time: '19:00', name: '경포 회센터', category: '맛집', desc: '제철 모둠회와 매운탕', cost: 35000, lat: 37.8020, lng: 128.9120 },
      ],
      [
        { time: '09:00', name: '초당순두부마을', category: '맛집', desc: '고소한 짬뽕순두부로 아침', cost: 11000, lat: 37.7905, lng: 128.9150 },
        { time: '10:30', name: '정동진', category: '자연', desc: '바다와 가장 가까운 기차역', cost: 0, lat: 37.6910, lng: 129.0343 },
        { time: '12:30', name: '하슬라아트월드', category: '관광', desc: '바다 절벽 위 조각 공원과 미술관', cost: 15000, lat: 37.7069, lng: 129.0090 },
        { time: '15:00', name: '강릉 커피박물관', category: '카페', desc: '커피 농장 체험과 로스터리', cost: 8000, lat: 37.7347, lng: 128.8330 },
        { time: '18:30', name: '주문진수산시장', category: '쇼핑', desc: '대게·건어물 구경하고 저녁', cost: 40000, lat: 37.8936, lng: 128.8296 },
      ],
      [
        { time: '09:30', name: '소금강 계곡', category: '자연', desc: '가볍게 걷는 오대산 계곡 트레킹', cost: 0, lat: 37.8126, lng: 128.7390 },
        { time: '12:00', name: '연곡 막국수', category: '맛집', desc: '시원한 동치미 막국수', cost: 10000, lat: 37.8580, lng: 128.8360 },
        { time: '14:00', name: '대관령 양떼목장', category: '자연', desc: '초원 언덕 산책과 건초 주기', cost: 7000, lat: 37.6880, lng: 128.7520 },
      ],
    ],
  },
  부산: {
    tagline: '바다 뷰와 시장 먹거리를 모두 챙기는 부산',
    lodging: { name: '해운대 마린 호텔', lat: 35.1600, lng: 129.1570, pricePerRoom: 150000 },
    days: [
      [
        { time: '11:00', name: '해동용궁사', category: '문화·역사', desc: '바닷가 바위 위에 지은 사찰', cost: 0, lat: 35.1884, lng: 129.2233 },
        { time: '13:00', name: '기장 대게거리', category: '맛집', desc: '찜 대게와 게살 볶음밥', cost: 45000, lat: 35.2420, lng: 129.2270 },
        { time: '15:30', name: '송정 해변 카페', category: '카페', desc: '서퍼들을 보며 쉬어가기', cost: 9000, lat: 35.1785, lng: 129.2000 },
        { time: '17:30', name: '해운대 블루라인파크', category: '관광', desc: '해변열차 타고 미포→청사포', cost: 7000, lat: 35.1595, lng: 129.1720 },
        { time: '19:30', name: '더베이101', category: '휴식', desc: '마린시티 야경과 요트 선착장', cost: 20000, lat: 35.1564, lng: 129.1520 },
      ],
      [
        { time: '09:30', name: '감천문화마을', category: '관광', desc: '알록달록 계단 마을 골목 산책', cost: 2000, lat: 35.0975, lng: 129.0106 },
        { time: '12:00', name: '자갈치시장', category: '맛집', desc: '꼼장어 구이와 생선구이 정식', cost: 25000, lat: 35.0966, lng: 129.0306 },
        { time: '14:00', name: '흰여울문화마을', category: '자연', desc: '절벽 위 바다 산책로', cost: 0, lat: 35.0784, lng: 129.0446 },
        { time: '16:30', name: '서면 쇼핑거리', category: '쇼핑', desc: '지하상가와 편집숍 구경', cost: 30000, lat: 35.1580, lng: 129.0600 },
        { time: '19:30', name: '광안리 해변', category: '휴식', desc: '광안대교 야경과 해변 산책', cost: 15000, lat: 35.1532, lng: 129.1187 },
      ],
      [
        { time: '10:00', name: '태종대', category: '자연', desc: '다누비 열차 타고 등대 전망대까지', cost: 4000, lat: 35.0532, lng: 129.0870 },
        { time: '12:30', name: '영도 해녀촌', category: '맛집', desc: '해산물 모둠과 성게 김밥', cost: 20000, lat: 35.0610, lng: 129.0790 },
        { time: '14:30', name: '전포카페거리', category: '카페', desc: '감성 카페 투어로 마무리', cost: 9000, lat: 35.1555, lng: 129.0640 },
      ],
    ],
  },
  경주: {
    tagline: '천년 고도를 천천히 걷는 역사 여행',
    lodging: { name: '보문 한옥 스테이', lat: 35.8420, lng: 129.2860, pricePerRoom: 140000 },
    days: [
      [
        { time: '11:30', name: '황리단길', category: '맛집', desc: '한옥 골목의 쌈밥·경주빵', cost: 15000, lat: 35.8375, lng: 129.2106 },
        { time: '13:30', name: '대릉원', category: '문화·역사', desc: '천마총과 거대한 고분 산책', cost: 3000, lat: 35.8382, lng: 129.2117 },
        { time: '15:00', name: '첨성대', category: '문화·역사', desc: '동양에서 가장 오래된 천문대', cost: 0, lat: 35.8347, lng: 129.2190 },
        { time: '16:30', name: '교촌마을 카페', category: '카페', desc: '최부잣집 근처 한옥 카페', cost: 8000, lat: 35.8300, lng: 129.2150 },
        { time: '19:00', name: '동궁과 월지', category: '관광', desc: '연못에 비친 신라 궁궐 야경', cost: 3000, lat: 35.8347, lng: 129.2266 },
      ],
      [
        { time: '09:00', name: '불국사', category: '문화·역사', desc: '다보탑·석가탑이 있는 세계유산', cost: 0, lat: 35.7900, lng: 129.3320 },
        { time: '11:00', name: '석굴암', category: '문화·역사', desc: '토함산 위 석굴 본존불', cost: 0, lat: 35.7949, lng: 129.3494 },
        { time: '13:00', name: '보문 순두부', category: '맛집', desc: '맷돌 순두부와 보리밥', cost: 12000, lat: 35.8400, lng: 129.2900 },
        { time: '15:00', name: '보문호 산책로', category: '자연', desc: '호숫가 벚나무길 자전거', cost: 10000, lat: 35.8430, lng: 129.2840 },
        { time: '18:00', name: '경주 월드', category: '액티비티', desc: '놀이기구로 신나는 저녁', cost: 45000, lat: 35.8370, lng: 129.2830 },
      ],
      [
        { time: '10:00', name: '양남 주상절리', category: '자연', desc: '부채꼴 주상절리 파도소리길', cost: 0, lat: 35.7270, lng: 129.4800 },
        { time: '12:30', name: '감포항 물회', category: '맛집', desc: '시원한 동해 물회', cost: 18000, lat: 35.8040, lng: 129.5040 },
        { time: '15:00', name: '양동마을', category: '문화·역사', desc: '조선 양반 마을 고택 산책', cost: 4000, lat: 36.0013, lng: 129.2500 },
      ],
    ],
  },
};

// 샘플이 없는 지역은 범용 일정으로 대체합니다.
function genericRegion(region) {
  const base = { lat: 36.0, lng: 128.0 };
  const mk = (time, name, category, desc, cost, dx, dy) =>
    ({ time, name: `${region} ${name}`, category, desc, cost, lat: base.lat + dy, lng: base.lng + dx });
  return {
    tagline: `${region}의 매력을 하나씩 담은 샘플 일정`,
    generic: true,
    lodging: { name: `${region} 시내 호텔`, lat: base.lat + 0.01, lng: base.lng + 0.02, pricePerRoom: 120000 },
    days: [
      [
        mk('11:00', '전통시장', '맛집', '지역 먹거리로 첫 끼', 15000, 0, 0),
        mk('13:30', '대표 명소', '관광', '꼭 들러야 할 랜드마크', 5000, 0.04, 0.02),
        mk('15:30', '감성 카페', '카페', '잠깐 쉬어가는 시간', 8000, 0.07, -0.01),
        mk('18:00', '야경 포인트', '휴식', '해 질 녘 산책', 0, 0.03, -0.03),
      ],
      [
        mk('09:30', '자연 산책로', '자연', '아침 공기 마시며 걷기', 0, -0.05, 0.04),
        mk('12:00', '향토 음식점', '맛집', '지역 별미 점심', 14000, -0.02, 0.06),
        mk('14:30', '박물관', '문화·역사', '지역의 역사 한눈에', 3000, 0.01, 0.05),
        mk('17:00', '상점가', '쇼핑', '기념품 쇼핑', 25000, 0.05, 0.03),
      ],
      [
        mk('10:00', '체험 공방', '액티비티', '만들기 체험', 20000, -0.03, -0.02),
        mk('12:30', '브런치 맛집', '맛집', '여유로운 마지막 식사', 16000, 0.0, -0.04),
      ],
    ],
  };
}

export function getRegionSample(region) {
  const key = Object.keys(REGIONS).find((k) => region.includes(k));
  return key ? { key, ...REGIONS[key] } : { key: region, ...genericRegion(region) };
}
