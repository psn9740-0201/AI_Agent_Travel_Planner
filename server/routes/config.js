// 브라우저에 공개해도 되는 설정만 전달합니다. (지도 SDK용 Client ID)
import { Router } from 'express';
import { publicConfig } from '../config/env.js';

const router = Router();
router.get('/', (req, res) => res.json(publicConfig));
export default router;
