// 프론트엔드 진입점
// - 첫 화면: 샘플 미리보기
// - "일정 만들기": POST /api/plan (NDJSON 스트림) → Function Calling Agent 의 진행 상황을 Trace 에 실시간 표시 → 결과 렌더링
// - 이동 시간·거리·비용은 서버가 NAVER API 결과로 채운 값만 표시합니다. (없으면 표시하지 않음)
import { api, accessCode } from './api.js';
import { CATEGORY, getRegionSample } from './sampleData.js';
import { createNaverMap } from './map.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const manwon = (n) => (Math.abs(n) >= 10000 ? `${(n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원` : won(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catColor = (c) => CATEGORY[c]?.color ?? 'var(--muted)';
const minutes = (ms) => Math.max(1, Math.round(ms / 60000));
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60 ? `${m % 60}분` : ''}`.trim() : `${m}분`);
const fmtKm = (m) => `${(m / 1000).toFixed(1)}km`;

const TRANSPORT = {
  car: { label: '자동차', icon: '🚗' },
  car_walk: { label: '자동차 + 도보', icon: '🚗' },
  transit: { label: '대중교통', icon: '🚌' },
};
const BUDGET_COLOR = { 숙박: '숙소', 식비: '맛집', '입장·체험': '관광', 쇼핑: '쇼핑', 교통: '액티비티', 기타: '휴식' };
const TOOL_ICON = { search_places: '🔍', get_routes: '🚗', calculate_budget: '🧮', web_search: '🌐' };

// 대한민국 범위의 좌표만 지도에 사용
const hasCoord = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat > 33 && p.lat < 39 && p.lng > 124 && p.lng < 132;

function dayDate(startDate, i) {
  const d = new Date(`${startDate}T00:00:00`);
  d.setDate(d.getDate() + i);
  return d;
}

// ── 폼 ─────────────────────────────────────────
const form = $('#trip-form');

function initForm() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  form.startDate.value = d.toLocaleDateString('sv-SE'); // YYYY-MM-DD (로컬)
  form.startDate.min = new Date().toLocaleDateString('sv-SE');

  $$('.quick[data-target]').forEach((box) =>
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('.pill');
      if (!btn) return;
      const input = form[box.dataset.target];
      input.value = box.dataset.target === 'budget' ? Number(btn.dataset.value).toLocaleString('ko-KR') : btn.dataset.value;
      input.closest('.field').classList.remove('invalid');
    }),
  );

  $$('.stepper-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      const v = (Number(form.people.value) || 1) + Number(btn.dataset.delta);
      form.people.value = Math.min(20, Math.max(1, v));
    }),
  );

  form.budget.addEventListener('input', () => {
    const digits = form.budget.value.replace(/\D/g, '').slice(0, 9);
    form.budget.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  });

  form.addEventListener('input', (e) => e.target.closest('.field')?.classList.remove('invalid'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    generate();
  });
  $('#alert-retry').addEventListener('click', () => generate());
}

function readForm() {
  return {
    region: form.region.value.trim(),
    startDate: form.startDate.value,
    days: Number(form.days.value),
    people: Math.min(20, Math.max(1, Number(form.people.value) || 1)),
    budget: Number(form.budget.value.replace(/\D/g, '')) || 0,
    prefs: $$('input[name="prefs"]:checked').map((i) => i.value),
    transport: form.transport.value,
    request: form.request.value.trim(),
  };
}

function validate(input) {
  const bad = [];
  if (!input.region) bad.push('region');
  if (!input.startDate) bad.push('startDate');
  if (input.budget < 10000) bad.push('budget');
  bad.forEach((name) => form[name].closest('.field').classList.add('invalid'));
  if (bad.length) {
    form[bad[0]].focus();
    showAlert('입력값을 확인해 주세요', bad.includes('budget') ? '총예산은 1만 원 이상이어야 해요.' : '빨간색으로 표시된 항목을 채워 주세요.', 'warn');
  }
  return bad.length === 0;
}

// ── 화면용 plan ────────────────────────────────
// { source, input, title, tagline, tips, sources, warnings, meta,
//   days[{ index, date, theme, routeChecked, items[{ time,name,category,naverCategory,address,lat,lng,link,description,move }] }],
//   budget (calculate_budget 결과 | null) }

function fromAgentResult(input, { plan, meta, warnings = [] }) {
  return {
    source: 'ai', input, meta, warnings,
    title: plan.title, tagline: plan.summary, tips: plan.tips ?? [], sources: plan.sources ?? [], searches: plan.searches ?? [],
    days: plan.days.map((d, i) => ({ ...d, index: i + 1, date: dayDate(input.startDate, i) })),
    budget: plan.budget,
  };
}

function fromSample(input) {
  const sample = getRegionSample(input.region);
  const days = Array.from({ length: input.days }, (_, i) => {
    const items = sample.days[i % sample.days.length].map((p) => ({
      time: p.time, name: p.name, category: p.category, naverCategory: '', address: '',
      lat: p.lat, lng: p.lng, description: p.desc, move: null,
    }));
    if (i < input.days - 1) {
      const l = sample.lodging;
      items.push({ time: '', name: l.name, category: '숙소', naverCategory: '', address: '', lat: l.lat, lng: l.lng, description: '샘플 숙소', move: null });
    }
    return { index: i + 1, date: dayDate(input.startDate, i), theme: '', items, routeChecked: false };
  });
  const nights = input.days - 1;
  return {
    source: 'sample', input, days, tips: [], sources: [], warnings: [], budget: null,
    title: `${input.region} ${nights ? `${nights}박 ${input.days}일` : '당일치기'} 여행`,
    tagline: sample.tagline,
  };
}

// 하루 이동 합계 (NAVER 길찾기 구간만)
function dayTotals(day) {
  const legs = day.items.map((p) => p.move).filter(Boolean);
  return {
    legs: legs.length,
    distanceM: legs.reduce((s, m) => s + m.distanceM, 0),
    durationMs: legs.reduce((s, m) => s + m.durationMs, 0),
  };
}

// ── 렌더링 ─────────────────────────────────────
const state = { plan: null, day: 0 };
const dateFmt = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

function render(plan) {
  state.plan = plan;
  state.day = 0;
  renderSummary(plan);
  renderTabs(plan);
  renderDay();
  renderBudget(plan);
  renderSources(plan);
}

function renderSummary({ input, title, tagline, tips, sources, days, budget, source }) {
  const range = `${dateFmt.format(days[0].date)}${days.length > 1 ? ` ~ ${dateFmt.format(days.at(-1).date)}` : ''}`;
  const badge = source === 'ai' ? '<span class="ai-badge">AI Agent</span>' : '<span class="sample-badge">샘플 미리보기</span>';
  const totals = days.map(dayTotals);
  const routedKm = totals.reduce((s, t) => s + t.distanceM, 0);
  const anyRoute = totals.some((t) => t.legs);
  $('#summary').innerHTML = `
    <div class="summary-title">
      <h2>${esc(title)}${badge}</h2>
      <p>${esc(tagline)} · ${range}</p>
    </div>
    <div class="summary-stats">
      <div class="stat"><b>${input.people}명</b><span>인원</span></div>
      <div class="stat"><b>${TRANSPORT[input.transport].icon} ${anyRoute ? fmtKm(routedKm) : '—'}</b><span>${anyRoute ? '이동 거리 (NAVER)' : '경로 미확인'}</span></div>
      <div class="stat"><b>${manwon(input.budget)}</b><span>총예산</span></div>
    </div>
    ${input.request ? `<p class="summary-note">💬 요청 반영: ${esc(input.request)}</p>` : ''}
    ${tips.length ? `<ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${sources.length ? `<div class="sources"><b>🌐 웹 출처 ${sources.length}개</b><span>아래 📚 출처에서 확인할 수 있어요</span></div>` : ''}`;
}

function renderTabs({ days }) {
  const box = $('#day-tabs');
  box.innerHTML = days
    .map((d, i) => `<button type="button" class="day-tab" role="tab" aria-selected="${i === state.day}" data-i="${i}">
        <b>Day ${d.index}</b><span>${dateFmt.format(d.date)}</span></button>`)
    .join('');
  box.onclick = (e) => {
    const btn = e.target.closest('.day-tab');
    if (!btn) return;
    state.day = Number(btn.dataset.i);
    $$('.day-tab', box).forEach((b, i) => b.setAttribute('aria-selected', i === state.day));
    renderDay();
  };
}

function moveLine(move, transport) {
  const basis = transport === 'transit' ? '자동차 기준 ' : '';
  const toll = move.tollFare ? ` · 통행료 ${won(move.tollFare)}` : '';
  return `<div class="tl-move" title="NAVER Directions 5 실시간 경로">🚗 ${basis}${fmtMin(minutes(move.durationMs))} · ${fmtKm(move.distanceM)}${toll}<span class="src">NAVER 길찾기</span></div>`;
}

function renderDay() {
  const { input, days, source } = state.plan;
  const day = days[state.day];
  $('#day-label').textContent = `Day ${day.index} · ${day.theme || dateFmt.format(day.date)}`;

  $('#timeline').innerHTML = day.items.length
    ? day.items
      .map((p, i) => `
      <li class="tl-item" data-i="${i}" style="--cat:${catColor(p.category)}">
        <div class="tl-time">${esc(p.time || (p.category === '숙소' ? '숙박' : ''))}</div>
        <div class="tl-body">
          <span class="tl-dot">${i + 1}</span>
          <div class="tl-card">
            <div class="tl-top">
              <span class="tl-name">${esc(p.name)}</span>
              <span class="tag">${CATEGORY[p.category]?.emoji ?? ''} ${esc(p.category)}</span>
              ${p.naverCategory ? `<span class="tag naver" title="NAVER 카테고리">${esc(p.naverCategory)}</span>` : ''}
              ${input.prefs.includes(p.category) ? '<span class="tag match">취향 저격</span>' : ''}
            </div>
            ${p.description ? `<p class="tl-desc">${esc(p.description)}</p>` : ''}
            ${p.reason ? `<p class="tl-reason"><b>추천 이유</b>${esc(p.reason)}</p>` : ''}
            ${p.address ? `<div class="tl-meta"><span>📍 ${esc(p.address)}</span></div>` : ''}
            ${p.source ? `<div class="tl-src">출처: <a href="${esc(placeHref(p))}" target="_blank" rel="noopener noreferrer">${esc(p.source.api)}</a> · 검색어 '${esc(p.source.query)}'</div>` : ''}
          </div>
          ${p.move ? moveLine(p.move, input.transport) : ''}
        </div>
      </li>`)
      .join('')
    : '<li class="empty">이 날은 일정이 비어 있어요.</li>';

  renderMap(day);
  const t = dayTotals(day);
  $('#route-stats').innerHTML = t.legs
    ? `<div><b>${day.items.length}곳</b><span>방문 장소</span></div>
       <div><b>${fmtKm(t.distanceM)}</b><span>이동 거리 (NAVER)</span></div>
       <div><b>${fmtMin(minutes(t.durationMs))}</b><span>${input.transport === 'transit' ? '자동차 기준 시간' : '이동 시간 (NAVER)'}</span></div>`
    : `<div><b>${day.items.length}곳</b><span>방문 장소</span></div>
       <div><b>—</b><span>이동 거리</span></div>
       <div><b>—</b><span>${source === 'ai' ? 'Agent가 경로를 조회하지 않음' : '샘플 · 경로 미조회'}</span></div>`;

  $$('.tl-item').forEach((li) => {
    li.onmouseenter = () => highlight(li.dataset.i, true);
    li.onmouseleave = () => highlight(li.dataset.i, false);
  });
}

function highlight(i, on) {
  $(`.tl-item[data-i="${i}"]`)?.classList.toggle('is-active', on);
  $(`.map-pin[data-i="${i}"]`)?.classList.toggle('is-active', on);
  mapState.view?.highlight(i, on);
}

// 장소 링크: API 가 준 홈페이지(http/https)가 있으면 그것, 없으면 NAVER 지도 검색
function placeHref(p) {
  if (/^https?:\/\//i.test(p.link ?? '')) return p.link;
  return `https://map.naver.com/p/search/${encodeURIComponent(`${p.name} ${p.address ?? ''}`.trim())}`;
}

// ── 지도: NAVER Web Dynamic Map, 실패 시 간이(SVG) 지도 ──────────
const mapState = { view: null, error: '' };

async function initMap() {
  const el = $('#naver-map');
  try {
    const { naverMapsClientId } = await api.config();
    el.hidden = false; // 크기가 있어야 지도가 그려짐
    $('#svg-map').hidden = true;
    const { view, error } = await createNaverMap(el, naverMapsClientId);
    if (!view) throw new Error(error);
    mapState.view = view;
    // 인증 실패는 로딩 후 비동기로 알려질 수 있음
    setTimeout(() => { if (view.isAuthFailed()) useSvgMap('NAVER 지도 인증 실패 — NCP 콘솔의 Web 서비스 URL(http://localhost)과 Dynamic Map 설정을 확인해 주세요.'); }, 2500);
  } catch (err) {
    useSvgMap(err.message);
  }
  if (state.plan) renderMap(state.plan.days[state.day]);
}

function useSvgMap(reason) {
  mapState.view = null;
  mapState.error = reason;
  $('#naver-map').hidden = true;
  $('#svg-map').hidden = false;
  if (state.plan) renderMap(state.plan.days[state.day]);
}

function renderMap(day) {
  const note = $('#map-note');
  const pts = day.items.map((p, i) => ({ ...p, i })).filter(hasCoord);
  if (mapState.view) {
    const { routeDrawn } = mapState.view.render(
      pts.map((p) => ({ i: p.i, name: p.name, lat: p.lat, lng: p.lng, address: p.address, color: catColor(p.category), move: p.move })),
      { esc, onHover: (i, on) => highlight(i, on), onClick: (i) => $(`.tl-item[data-i="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) },
    );
    $('#map-sub').textContent = 'NAVER Maps · Web Dynamic Map';
    note.hidden = false;
    note.className = 'map-note';
    note.textContent = routeDrawn
      ? `🚗 실제 자동차 경로 ${routeDrawn}구간을 표시했어요 (NAVER Directions 5).`
      : state.plan.source === 'ai' ? '경로 정보가 없어 마커만 표시했어요.' : '샘플 미리보기 · 마커만 표시';
    return;
  }
  $('#map-sub').textContent = '간이 지도 (좌표 투영)';
  note.hidden = !mapState.error;
  note.className = 'map-note warn';
  note.textContent = mapState.error ? `⚠️ ${mapState.error}` : '';
  renderSvgMap(day, pts);
}

// 좌표를 SVG에 투영한 간이 지도 (NAVER 지도를 쓸 수 없을 때)
function renderSvgMap(day, pts) {
  const W = 400, H = 300, PAD = 44;
  if (!pts.length) {
    $('#svg-map').innerHTML = '<div class="map-empty">표시할 좌표가 없어요</div>';
    return;
  }
  const midLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = pts.map((p) => p.lng * kx), ys = pts.map((p) => p.lat);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 0.005);
  const scale = Math.min((W - PAD * 2) / span, (H - PAD * 2) / span);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const xy = pts.map((p) => [W / 2 + (p.lng * kx - cx) * scale, H / 2 - (p.lat - cy) * scale]);

  const d = xy.reduce((acc, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = xy[i - 1];
    const mx = (px + x) / 2 + (y - py) * 0.12, my = (py + y) / 2 - (x - px) * 0.12;
    return `${acc} Q${mx},${my} ${x},${y}`;
  }, '');

  // 라벨 겹침 방지: 오른쪽 → 왼쪽 → 아래 순으로 자리를 찾고, 없으면 번호만 표시
  const placed = xy.map(([x, y]) => ({ x0: x - 11, x1: x + 11, y0: y - 30, y1: y }));
  const hit = (b) => placed.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  const labels = xy.map(([x, y], k) => {
    const w = pts[k].name.length * 11 + 4;
    const options = [
      { x: x + 14, y: y - 14, anchor: 'start', box: { x0: x + 13, x1: x + 14 + w, y0: y - 25, y1: y - 10 } },
      { x: x - 14, y: y - 14, anchor: 'end', box: { x0: x - 14 - w, x1: x - 13, y0: y - 25, y1: y - 10 } },
      { x, y: y + 14, anchor: 'middle', box: { x0: x - w / 2, x1: x + w / 2, y0: y + 3, y1: y + 18 } },
    ];
    const pick = options.find((o) => o.box.x0 >= 0 && o.box.x1 <= W && !hit(o.box));
    if (pick) placed.push(pick.box);
    return pick;
  });

  const pins = xy
    .map(([x, y], k) => {
      const p = pts[k];
      const lb = labels[k];
      return `<g class="map-pin" data-i="${p.i}">
        <title>${p.i + 1}. ${esc(p.name)}</title>
        <path d="M${x},${y} c-4,-6 -11,-10 -11,-18 a11,11 0 1 1 22,0 c0,8 -7,12 -11,18z" fill="${catColor(p.category)}" stroke="#fff" stroke-width="2"/>
        <text x="${x}" y="${y - 14.5}" text-anchor="middle" fill="#fff" font-size="11" font-weight="800">${p.i + 1}</text>
        ${lb ? `<text class="map-label" x="${lb.x}" y="${lb.y}" text-anchor="${lb.anchor}">${esc(p.name)}</text>` : ''}
      </g>`;
    })
    .join('');

  $('#svg-map').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Day ${day.index} 경로 지도">
      <path class="route-line" d="${d}"/>${pins}</svg>`;

  $$('.map-pin').forEach((g) => {
    g.onmouseenter = () => highlight(g.dataset.i, true);
    g.onmouseleave = () => highlight(g.dataset.i, false);
    g.onclick = () => $(`.tl-item[data-i="${g.dataset.i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

// 예산: calculate_budget 결과만 표로 표시 (확인된 비용 vs 권장 배분 구분)
function renderBudget({ input, budget, source }) {
  const view = $('#budget-view');
  if (!budget) {
    $('#budget-sub').textContent = source === 'ai' ? 'calculate_budget 미호출' : '샘플';
    view.innerHTML = `
      <table class="budget-table"><tbody>
        <tr class="sum"><td>총예산</td><td class="num">${won(input.budget)}</td></tr>
      </tbody></table>
      <p class="empty">${source === 'ai'
        ? 'Agent가 이번 일정에서 예산 계산 도구를 사용하지 않았어요.<br/>확인되지 않은 가격은 표시하지 않아요.'
        : 'AI Agent가 일정을 만들면 NAVER 길찾기 유류비·통행료를 기준으로 예산을 점검해요.'}</p>`;
    return;
  }
  const { verifiedCosts, verifiedTotal, remaining, allocation, totalBudget, notes } = budget;
  const base = Math.max(totalBudget, verifiedTotal, 1);
  const allocTotal = allocation.reduce((s, a) => s + a.amount, 0);
  const sw = (cat, alloc = false) => `<span class="sw${alloc ? ' alloc' : ''}" style="--cat:${catColor(BUDGET_COLOR[cat])}"></span>`;
  $('#budget-sub').textContent = 'calculate_budget 결과';
  view.innerHTML = `
    <div class="budget-total">
      <div><div class="big">${won(remaining)}</div><div class="of">잔여 예산 · 총예산 ${won(totalBudget)}</div></div>
      <span class="budget-state ${remaining < 0 ? 'over' : 'ok'}">${remaining < 0 ? `${manwon(-remaining)} 초과` : `확인 비용 ${manwon(verifiedTotal)}`}</span>
    </div>
    <div class="stack">
      ${verifiedCosts.map((c) => `<i style="width:${(c.amount / base) * 100}%;--cat:${catColor(BUDGET_COLOR[c.category])}" title="${esc(c.label)}"></i>`).join('')}
      ${allocation.map((a) => `<i class="alloc" style="width:${(a.amount / base) * 100}%;--cat:${catColor(BUDGET_COLOR[a.category])}" title="${esc(a.category)} 권장 배분"></i>`).join('')}
    </div>
    <table class="budget-table">
      <thead><tr><th>항목</th><th>구분</th><th class="num">금액</th></tr></thead>
      <tbody>
        ${verifiedCosts.map((c) => `<tr>
          <td>${sw(c.category)}${esc(c.label)}<small>출처: ${esc(c.source)}${c.perPerson ? ` · 1인 ${won(c.perPerson)}` : ''}</small></td>
          <td><span class="kind ok">확인된 비용</span></td>
          <td class="num">${won(c.amount)}</td></tr>`).join('') || '<tr><td colspan="3"><small>확인된 비용이 없어요.</small></td></tr>'}
        <tr class="sum"><td colspan="2">예상 비용 합계 (확인된 비용)</td><td class="num">${won(verifiedTotal)}</td></tr>
        <tr class="rest${remaining < 0 ? ' over' : ''}"><td colspan="2">잔여 예산 (총예산 − 예상 비용)</td><td class="num">${won(remaining)}</td></tr>
        ${allocation.map((a) => `<tr>
          <td>${sw(a.category, true)}${esc(a.category)}<small>${a.perNight ? `1박 ${won(a.perNight)} 이내` : a.perPersonPerDay ? `1인 1일 ${won(a.perPersonPerDay)} 이내` : `1인 ${won(a.perPerson)} 이내`}</small></td>
          <td><span class="kind plan">권장 배분</span></td>
          <td class="num">${won(a.amount)}</td></tr>`).join('')}
        ${allocation.length ? `<tr class="sum"><td colspan="2">잔여 예산 권장 배분 합계 <small>실제 가격 아님</small></td><td class="num">${won(allocTotal)}</td></tr>` : ''}
      </tbody>
    </table>
    <ul class="budget-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
}

// 출처: NAVER 지역 검색(검색어별) · NAVER 길찾기 · 웹 검색
function renderSources(plan) {
  const view = $('#sources-view');
  if (plan.source !== 'ai') {
    view.innerHTML = '<p class="empty">샘플 미리보기에는 실제 출처가 없어요. AI Agent가 일정을 만들면 검색·경로·웹 출처를 보여 드려요.</p>';
    return;
  }
  const used = plan.days.flatMap((d) => d.items).filter((p) => p.source);
  const byQuery = new Map();
  for (const p of used) {
    if (!byQuery.has(p.source.query)) byQuery.set(p.source.query, []);
    if (!byQuery.get(p.source.query).some((x) => x.name === p.name)) byQuery.get(p.source.query).push(p);
  }
  const legs = plan.days.flatMap((d) => d.items.filter((p) => p.move).map(() => d.index));
  const searches = plan.searches ?? [];
  view.innerHTML = `<div class="src-grid">
    <div class="src-box">
      <h3>🔍 NAVER 지역 검색 <small>장소명·주소·좌표·카테고리</small></h3>
      <ul>${[...byQuery].map(([q, ps]) => `<li>'${esc(q)}' → ${ps.map((p) => `<a href="${esc(placeHref(p))}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a>`).join(', ')}</li>`).join('') || '<li>사용된 장소 없음</li>'}</ul>
      ${searches.length ? `<p><small>Agent 검색 ${searches.length}회: ${searches.map((s) => `'${esc(s.query)}'(${s.count}${s.cached ? ', 캐시' : ''})`).join(', ')}</small></p>` : ''}
    </div>
    <div class="src-box">
      <h3>🚗 NAVER Directions 5 <small>이동 시간·거리·통행료·유류비·경로</small></h3>
      <ul>${legs.length ? [...new Set(legs)].map((d) => `<li>Day ${d}: ${legs.filter((x) => x === d).length}구간</li>`).join('') : '<li>이번 일정에서는 경로를 조회하지 않았어요.</li>'}</ul>
      <p><small>실시간 교통 반영 값이라 실제 이동 시간은 달라질 수 있어요.</small></p>
    </div>
    <div class="src-box">
      <h3>🌐 웹 검색 <small>OpenAI web_search</small></h3>
      <ul>${plan.sources.length ? plan.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('') : '<li>이번 일정에서는 웹 검색을 사용하지 않았어요.</li>'}</ul>
    </div>
  </div>`;
}

// ── 알림 ───────────────────────────────────────
function showAlert(title, msg, kind = 'error') {
  const box = $('#alert');
  box.className = `alert ${kind === 'warn' ? 'warn' : ''}`;
  $('.alert-icon', box).textContent = kind === 'warn' ? '💡' : '⚠️';
  $('#alert-title').textContent = title;
  $('#alert-msg').textContent = msg;
  box.hidden = false;
}
const hideAlert = () => { $('#alert').hidden = true; };

// ── Agent Trace ────────────────────────────────
const log = {
  t0: 0,
  reset() {
    $('#agent-log').innerHTML = '';
    this.t0 = performance.now();
    traceFilter.counts = {};
    applyTraceFilter('');
  },
  add({ type, icon, title, detail, code, tool }, pending = false) {
    const li = document.createElement('li');
    li.className = `log-item${pending ? ' pending' : ''}`;
    li.dataset.type = type;
    if (tool) li.dataset.tool = tool;
    if (traceFilter.active && tool === traceFilter.active) li.classList.add('match');
    li.innerHTML = `<span class="log-icon">${icon}</span>
      <div class="log-body">
        <div class="log-title"><span>${esc(title)}</span><time>+${((performance.now() - this.t0) / 1000).toFixed(1)}s</time></div>
        <p class="log-detail"${detail ? '' : ' hidden'}>${esc(detail)}</p>
        ${code ? `<pre class="log-code">${esc(code)}</pre>` : ''}
      </div>`;
    const list = $('#agent-log');
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
    return li;
  },
  // 진행 중 항목: 경과 시간을 실시간 갱신하고, 끝나면 update 로 내용을 바꿉니다.
  wait(step) {
    const li = this.add(step, true);
    const timeEl = $('time', li);
    const started = performance.now();
    const timer = setInterval(() => { timeEl.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s…`; }, 100);
    return ({ title, detail, type } = {}) => {
      clearInterval(timer);
      li.classList.remove('pending');
      timeEl.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
      if (title) $('.log-title span', li).textContent = title;
      if (type) li.dataset.type = type;
      if (detail) { const p = $('.log-detail', li); p.textContent = detail; p.hidden = false; }
    };
  },
};

// ── Trace 도구 필터 칩 ──────────────────────────
const traceFilter = { counts: {}, active: null };
const CHIP_LABEL = { llm: '🧠 LLM 판단', search_places: '🔍 search_places', get_routes: '🚗 get_routes', calculate_budget: '🧮 calculate_budget', web_search: '🌐 web_search' };

function countTool(tool) {
  traceFilter.counts[tool] = (traceFilter.counts[tool] ?? 0) + 1;
  renderToolChips();
}

function renderToolChips() {
  const box = $('#tool-chips');
  const entries = Object.entries(traceFilter.counts);
  box.innerHTML = entries.length
    ? `<button type="button" class="tool-chip" data-tool="" aria-pressed="${!traceFilter.active}">전체</button>` +
      entries.map(([t, n]) => `<button type="button" class="tool-chip" data-tool="${t}" aria-pressed="${traceFilter.active === t}">${CHIP_LABEL[t] ?? t}<b>${n}</b></button>`).join('')
    : '';
}

function applyTraceFilter(tool) {
  traceFilter.active = tool || null;
  const list = $('#agent-log');
  list.classList.toggle('filtered', Boolean(tool));
  $$('.log-item', list).forEach((li) => li.classList.toggle('match', li.dataset.tool === tool));
  renderToolChips();
}

const prettyArgs = (raw) => {
  try {
    return Object.entries(JSON.parse(raw)).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  } catch { return raw; }
};

// 스트림 이벤트 → Trace
function traceHandler() {
  let thinking = null;
  let finalizing = null;
  const calls = new Map();
  let toolCount = 0;
  return (e) => {
    switch (e.type) {
      case 'start':
        log.add({ type: 'think', icon: '🚀', title: 'Agent 시작', detail: `사용 가능 도구: ${e.tools.join(', ')} · 최대 ${e.limits.MAX_TURNS}회 반복` });
        break;
      case 'thinking':
        countTool('llm');
        thinking = log.wait({ type: 'think', tool: 'llm', icon: '🧠', title: `LLM 판단 #${e.turn}`, detail: '다음에 무엇을 할지 결정하는 중…' });
        break;
      case 'model':
        thinking?.({
          title: e.decision === 'answer' ? `LLM 판단 #${e.turn} → 도구 사용 종료` : `LLM 판단 #${e.turn} → ${e.decision.join(', ')}`,
          detail: `${e.decision === 'answer' ? '충분한 정보를 모아 일정 초안 작성' : `${e.decision.length}개 도구 선택`} · 토큰 ${e.tokens.input.toLocaleString()} / ${e.tokens.output.toLocaleString()}`,
        });
        thinking = null;
        break;
      case 'web_search':
        toolCount++;
        countTool('web_search');
        log.add({ type: e.status === 'failed' ? 'error' : 'result', tool: 'web_search', icon: TOOL_ICON.web_search, title: 'web_search (OpenAI 내장)', detail: e.summary });
        break;
      case 'tool_call':
        toolCount++;
        countTool(e.name);
        calls.set(e.callId, log.wait({ type: 'tool', tool: e.name, icon: TOOL_ICON[e.name] ?? '🔧', title: e.name, code: prettyArgs(e.args) }));
        $('#log-sub').textContent = `도구 ${toolCount}회 호출 · 실행 중…`;
        break;
      case 'tool_result':
        calls.get(e.callId)?.({ title: `${e.name} ${e.ok ? '✓' : '✗ 실패'}`, detail: e.summary, type: e.ok ? 'tool' : 'error' });
        break;
      case 'guard':
        log.add({ type: 'error', icon: '🛡️', title: '정보 부족 점검', detail: e.message });
        break;
      case 'limit':
        log.add({ type: 'error', icon: '⛔', title: '반복 제한', detail: e.message });
        break;
      case 'finalizing':
        finalizing = log.wait({ type: 'think', icon: '📝', title: '최종 일정 정리', detail: '도구 결과로 일정 JSON 작성 중…' });
        break;
      case 'finalized':
        finalizing?.({ title: '최종 일정 정리 완료', detail: 'placeId → NAVER 장소·좌표·경로 연결' });
        break;
      default:
        break;
    }
  };
}

const tripLabel = (t) => `${t.region} · ${t.days === 1 ? '당일치기' : `${t.days - 1}박 ${t.days}일`} · ${t.people}명 · ${manwon(t.budget)} · ${TRANSPORT[t.transport].label}`;

// ── 접근 코드 ──────────────────────────────────
// 서버가 ACCESS_CODE_REQUIRED(401)를 돌려주면 코드를 입력받고 같은 요청을 한 번 더 시도합니다.
function askAccessCode(message) {
  const dlg = $('#access-dialog');
  $('#access-msg').textContent = message;
  $('#access-input').value = '';
  dlg.showModal();
  $('#access-input').focus();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const v = $('#access-input').value.trim();
      if (dlg.returnValue === 'ok' && v) { accessCode.set(v); resolve(true); } else resolve(false);
    }, { once: true });
  });
}

async function withAccess(fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.code !== 'ACCESS_CODE_REQUIRED') throw err;
      accessCode.clear();
      const ok = await askAccessCode(attempt === 0 && !err.message.includes('올바르지') ? '이 서비스는 접근 코드가 있어야 사용할 수 있어요.' : err.message);
      if (!ok) throw new Error('접근 코드를 입력하지 않아 요청을 취소했어요.');
    }
  }
  throw new Error('접근 코드가 올바르지 않습니다.');
}

// ── 실행 ───────────────────────────────────────
let busy = false;

function setLoading(on) {
  busy = on;
  const btn = $('#submit-btn');
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  $('.btn-label', btn).textContent = on ? 'AI Agent가 일하는 중…' : '✨ 여행 일정 만들기';
  $('#results').classList.toggle('is-loading', on);
  $('#results').setAttribute('aria-busy', on);
}

async function generate() {
  if (busy) return;
  hideAlert();
  const input = readForm();
  if (!validate(input)) return;

  setLoading(true);
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#log-sub').textContent = '실행 중…';
  log.reset();
  log.add({ type: 'think', icon: '📋', title: '요청 정리', detail: tripLabel(input) });

  try {
    const res = await withAccess(() => api.planStream(input, traceHandler()));
    const plan = fromAgentResult(input, res);
    const { meta } = res;
    const counts = Object.entries(meta.toolCounts).map(([k, v]) => `${k} ${v}`).join(' · ') || '도구 미사용';
    log.add({ type: 'done', icon: '✅', title: '여행 계획 완성', detail: `${counts} · ${(meta.durationMs / 1000).toFixed(1)}s · 토큰 ${meta.usage.inputTokens.toLocaleString()} / ${meta.usage.outputTokens.toLocaleString()}` });
    res.warnings?.forEach((w) => log.add({ type: 'error', icon: '⚠️', title: '주의', detail: w }));
    $('#log-sub').textContent = `${meta.model} · 도구 ${meta.toolCalls + (meta.toolCounts.web_search ?? 0)}회 · ${(meta.durationMs / 1000).toFixed(1)}s`;

    render(plan);
    checkServer(); // 남은 횟수 갱신
    if (res.warnings?.length) showAlert('참고해 주세요', res.warnings.join(' '), 'warn');
  } catch (err) {
    log.add({ type: 'error', icon: '❌', title: '오류', detail: err.message });
    $('#log-sub').textContent = '실패';
    showAlert('일정을 만들지 못했어요', err.message);
  } finally {
    setLoading(false);
  }
}

async function checkServer() {
  const badge = $('#mode-badge');
  try {
    const { missingEnv, usage } = await api.health();
    const aiReady = !missingEnv.some((k) => k.startsWith('OPENAI'));
    const left = usage ? Math.max(0, usage.plans.limit - usage.plans.used) : null;
    badge.textContent = aiReady ? `AI Agent 준비됨${left !== null ? ` · 오늘 ${left}회 남음` : ''}` : 'OpenAI 설정 필요';
    badge.title = usage ? `오늘 사용량 — 일정 ${usage.plans.used}/${usage.plans.limit}, 토큰 ${usage.tokens.used.toLocaleString()}/${usage.tokens.limit.toLocaleString()}, 웹검색 ${usage.webSearch.used}/${usage.webSearch.limit}, 장소검색 ${usage.naverSearch.used}/${usage.naverSearch.limit}, 길찾기 ${usage.naverDirections.used}/${usage.naverDirections.limit}` : '';
    badge.className = `mode-badge${aiReady ? '' : ' off'}`;
    if (!aiReady) showAlert('OpenAI 설정이 필요해요', `.env의 ${missingEnv.filter((k) => k.startsWith('OPENAI')).join(', ')} 값을 확인해 주세요.`, 'warn');
  } catch {
    badge.textContent = '서버 연결 안 됨';
    badge.className = 'mode-badge err';
  }
}

// ── 장소 검색 (NAVER 지역 검색) ─────────────────
// API가 준 값(장소명·주소·카테고리·좌표·링크)만 표시합니다. 영업시간·평점·가격은 만들지 않습니다.
const searchForm = $('#search-form');
let searching = false;

function syncSearchRegion() {
  $('#search-region').textContent = form.region.value.trim() || '지역 미입력';
}

function placeCard(p, i) {
  const addr = p.roadAddress || p.address;
  const sub = p.roadAddress && p.address && p.address !== p.roadAddress ? `<small>지번 ${esc(p.address)}</small>` : '';
  const coord = p.lat !== null ? `<code>${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</code>` : '<span>좌표 없음</span>';
  const homepage = /^https?:\/\//i.test(p.link) ? p.link : '';
  const href = homepage || `https://map.naver.com/p/search/${encodeURIComponent(`${p.name} ${addr}`)}`;
  return `<li class="place">
    <div class="place-head"><span class="place-no">${i + 1}</span><span class="place-name">${esc(p.name)}</span></div>
    ${p.category ? `<span class="place-cat" title="${esc(p.category)}">${esc(p.categoryShort)}</span>` : ''}
    <p class="place-addr">${esc(addr || '주소 정보 없음')}${sub}</p>
    <div class="place-foot">${coord}<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${homepage ? '홈페이지 ↗' : '네이버 지도 ↗'}</a></div>
  </li>`;
}

async function runSearch(keyword) {
  if (searching) return;
  const region = form.region.value.trim();
  const kw = (keyword ?? $('#search-keyword').value).trim();
  const status = $('#search-status');
  const list = $('#search-results');
  if (!region && !kw) {
    status.className = 'search-status error';
    status.textContent = '여행 지역이나 키워드를 입력해 주세요.';
    form.region.focus();
    return;
  }
  $('#search-keyword').value = kw;
  $$('#search-quick .pill').forEach((b) => b.classList.toggle('is-on', b.dataset.keyword === kw));

  searching = true;
  $('.btn-search', searchForm).disabled = true;
  status.className = 'search-status';
  status.textContent = `'${[region, kw].filter(Boolean).join(' ')}' 검색 중…`;
  list.innerHTML = '<li class="skeleton"></li>'.repeat(3);

  try {
    const res = await withAccess(() => api.searchPlaces({ region, keyword: kw, sort: $('#search-sort').value }));
    if (!res.items.length) {
      list.innerHTML = '';
      status.textContent = `'${res.query}' 검색 결과가 없어요. 다른 키워드로 찾아보세요.`;
      return;
    }
    status.textContent = `'${res.query}' 검색 결과 ${res.items.length}곳${res.total > res.items.length ? ` (전체 ${res.total.toLocaleString()}건 중)` : ''}`;
    list.innerHTML = res.items.map(placeCard).join('');
  } catch (err) {
    list.innerHTML = '';
    status.className = 'search-status error';
    status.textContent = `⚠️ ${err.message}`;
  } finally {
    searching = false;
    $('.btn-search', searchForm).disabled = false;
  }
}

function initSearch() {
  syncSearchRegion();
  form.region.addEventListener('input', syncSearchRegion);
  // initForm 의 값 설정 핸들러보다 뒤에 등록되어, 값이 바뀐 뒤 동기화됩니다.
  $('.quick[data-target="region"]').addEventListener('click', syncSearchRegion);
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
  });
  $('#search-quick').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (btn) runSearch(btn.dataset.keyword);
  });
}

// ── 시작 ───────────────────────────────────────
initForm();
initSearch();
checkServer();
$('#tool-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.tool-chip');
  if (chip) applyTraceFilter(chip.dataset.tool);
});

const preview = fromSample(readForm());
render(preview);
log.reset();
log.add({ type: 'think', icon: '👀', title: '샘플 미리보기', detail: '"여행 일정 만들기"를 누르면 AI Agent가 필요한 도구를 스스로 골라 실제 일정을 만들어요.' });
$('#log-sub').textContent = '대기 중';
initMap();
