// [Level 1] GET /api/places?region=강릉&keyword=카페&sort=comment
import { Router } from 'express';
import { search_places } from '../services/naverSearch.js';

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const result = await search_places({
      region: clean(req.query.region, 30),
      keyword: clean(req.query.keyword ?? req.query.query, 50),
      sort: req.query.sort === 'random' ? 'random' : 'comment',
    });
    res.json(result);
  } catch (err) { next(err); }
});
export default router;
