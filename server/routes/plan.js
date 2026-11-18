// POST /api/plan — 여행 조건을 검증한 뒤 Agent 를 실행하고, 진행 상황을 NDJSON 으로 스트리밍합니다.
//   응답: application/x-ndjson, 한 줄에 이벤트 하나 ({type: ...})
//   마지막 줄: {type:'result', ...} 또는 {type:'error', message}
import { Router } from 'express';
import { runTravelAgent } from '../agent/travelAgent.js';
import { HttpError } from '../middleware/errorHandler.js';
import { PLACE_CATEGORIES } from '../prompts/travelPlan.js';
import { acquirePlanSlot, assertAvailable, consume } from '../security/usageGuard.js';

const TRANSPORTS = ['car', 'car_walk', 'transit'];
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

function parseTrip(body = {}) {
  const region = clean(body.region, 30);
  const startDate = clean(body.startDate, 10);
  const days = Number(body.days);
  const people = Number(body.people);
  const budget = Number(body.budget);
  const transport = TRANSPORTS.includes(body.transport) ? body.transport : 'car';
  const prefs = (Array.isArray(body.prefs) ? body.prefs : []).filter((p) => PLACE_CATEGORIES.includes(p));
  const request = clean(body.request, 500);

  if (!region) throw new HttpError(400, '여행 지역을 입력해 주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) throw new HttpError(400, '출발일 형식이 올바르지 않습니다.');
  if (!Number.isInteger(days) || days < 1 || days > 5) throw new HttpError(400, '여행 기간은 1~5일만 가능합니다.');
  if (!Number.isInteger(people) || people < 1 || people > 20) throw new HttpError(400, '인원은 1~20명만 가능합니다.');
  if (!Number.isFinite(budget) || budget < 10000 || budget > 100_000_000) throw new HttpError(400, '총예산은 1만 원 이상으로 입력해 주세요.');

  return { region, startDate, days, people, budget, transport, prefs, request };
}

const router = Router();
router.post('/', async (req, res, next) => {
  let trip;
  let release = async () => {};
  try {
    trip = parseTrip(req.body);
    // 비용 통제: 스트림을 열기 전에 확인 → 초과 시 일반 JSON 429 응답
    await assertAvailable('tokens');
    release = await acquirePlanSlot();
    await consume('plans');
  } catch (err) {
    await release();
    return next(err);
  }

  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // 브라우저가 연결을 끊으면 Agent 도 중단
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  const send = (evt) => { if (!res.writableEnded) res.write(`${JSON.stringify({ ...evt, t: Date.now() })}\n`); };

  try {
    const result = await runTravelAgent(trip, { onEvent: send, signal: ctrl.signal });
    send({ type: 'result', ...result });
  } catch (err) {
    if (err.status !== 499) console.error('[agent]', err.message);
    send({ type: 'error', status: err.status ?? 500, message: err.expose ? err.message : '일정을 만드는 중 서버 오류가 발생했습니다.' });
  } finally {
    await release();
    res.end();
  }
});
export default router;
