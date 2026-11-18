// search_places 독립 테스트 — 서버/브라우저 없이 NAVER API HUB 지역 검색만 실제로 호출합니다.
// 실행: npm run test:search
import assert from 'node:assert/strict';
import { env } from '../server/config/env.js';
import { search_places, parseCoord } from '../server/services/naverSearch.js';

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`❌ ${name}\n   ${err.message}`);
  }
}
const km = (a, b) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const show = (items) => items.forEach((p, i) =>
  console.log(`   ${i + 1}. ${p.name} [${p.categoryShort}] ${p.roadAddress || p.address} (${p.lat}, ${p.lng})`));

console.log('NAVER API HUB 지역 검색 테스트');
console.log(`인증 정보: ID ${env.naverSearch.clientId ? '설정됨' : '없음'} / Secret ${env.naverSearch.clientSecret ? '설정됨' : '없음'}\n`);

// 1) 좌표 파서 단위 테스트 (네트워크 없음)
await test('parseCoord: 10^7 정수 / 소수 / 잘못된 값', () => {
  assert.deepEqual(parseCoord('1269770162', '375796090'), { lat: 37.579609, lng: 126.9770162 });
  assert.deepEqual(parseCoord('126.977', '37.5796'), { lat: 37.5796, lng: 126.977 });
  assert.equal(parseCoord('', ''), null);
  assert.equal(parseCoord('0', '0'), null);
  assert.equal(parseCoord('1000000000', '100000000'), null); // 한국 범위 밖
});

// 2) 원본 응답의 좌표 형식 확인 + 알려진 위치와 비교
await test('좌표 검증: 경복궁 (실제 위치 37.5796, 126.9770 근처)', async () => {
  const raw = await fetch('https://naverapihub.apigw.ntruss.com/search/v1/local?query=' + encodeURIComponent('경복궁') + '&display=1', {
    headers: { 'X-NCP-APIGW-API-KEY-ID': env.naverSearch.clientId, 'X-NCP-APIGW-API-KEY': env.naverSearch.clientSecret },
  }).then((r) => r.json());
  console.log(`   원본 mapx=${JSON.stringify(raw.items?.[0]?.mapx)} mapy=${JSON.stringify(raw.items?.[0]?.mapy)}`);
  const { items } = await search_places({ region: '서울', keyword: '경복궁', display: 1 });
  assert.ok(items.length > 0, '결과 없음');
  const d = km(items[0], { lat: 37.5796, lng: 126.977 });
  console.log(`   변환 (${items[0].lat}, ${items[0].lng}) → 기준점과 ${d.toFixed(2)}km 차이`);
  assert.ok(d < 1.5, `좌표가 ${d.toFixed(1)}km 떨어져 있음 — 형식 확인 필요`);
});

// 3) 여행 지역 + 키워드 조합 (관광지 / 음식점 / 카페)
for (const [region, keyword] of [['강릉', '관광지'], ['부산', '맛집'], ['경주', '카페']]) {
  await test(`search_places({ region: '${region}', keyword: '${keyword}' })`, async () => {
    const r = await search_places({ region, keyword });
    assert.equal(r.query, `${region} ${keyword}`);
    assert.ok(r.items.length > 0 && r.items.length <= 5, `결과 수 ${r.items.length}`);
    for (const p of r.items) {
      assert.ok(p.name && !/<\/?b>/.test(p.name), `장소명 이상: ${p.name}`);
      assert.ok(p.address || p.roadAddress, `${p.name}: 주소 없음`);
      assert.ok(p.category, `${p.name}: 카테고리 없음`);
      assert.ok(p.lat !== null && p.lng !== null, `${p.name}: 좌표 없음`);
      // API가 주지 않는 정보는 결과 객체에 없어야 함
      for (const k of ['rating', 'hours', 'price', 'openingHours']) assert.ok(!(k in p), `임의 필드 ${k} 존재`);
    }
    show(r.items);
  });
}

// 4) 지역명 중복 방지
await test('키워드에 지역명이 이미 있으면 중복하지 않음', async () => {
  const r = await search_places({ region: '강릉', keyword: '강릉 순두부', display: 2 });
  assert.equal(r.query, '강릉 순두부');
});

// 5) 입력 오류
await test('빈 입력은 400 오류', async () => {
  await assert.rejects(() => search_places({ region: '', keyword: '' }), (e) => e.status === 400);
});

console.log(failed ? `\n${failed}개 실패` : '\n모든 테스트 통과');
process.exit(failed ? 1 : 0);
