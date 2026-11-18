// POST /api/route  { points: [{ name, lat, lng }, ...] } → 구간별 자동차 경로 (NAVER Directions 5)
import { Router } from 'express';
import { getLegs } from '../services/naverMaps.js';
import { HttpError } from '../middleware/errorHandler.js';

const valid = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && p.lat > 33 && p.lat < 39 && p.lng > 124 && p.lng < 132;

const router = Router();
router.post('/', async (req, res, next) => {
  try {
    const points = Array.isArray(req.body?.points) ? req.body.points.slice(0, 10) : [];
    if (points.length < 2 || !points.every(valid)) throw new HttpError(400, '좌표가 있는 지점을 2개 이상 보내 주세요.');
    const legs = await getLegs(points.map((p, i) => ({ id: String(i), name: String(p.name ?? ''), lat: p.lat, lng: p.lng })));
    res.json({ legs });
  } catch (err) { next(err); }
});
export default router;
