// Express 앱 정의 (서버 실행과 분리)
// - 로컬: server/index.js 가 이 앱으로 app.listen()
// - Vercel: 루트 app.js 가 이 앱을 default export → 하나의 Vercel Function 으로 실행
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, missingEnv } from './config/env.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { securityHeaders, sameOriginOnly, rateLimit, requireAccessCode, accessCodeRequired } from './middleware/security.js';
import { usageSummary, storeKind } from './security/usageGuard.js';
import configRouter from './routes/config.js';
import placesRouter from './routes/places.js';
import planRouter from './routes/plan.js';
import routeRouter from './routes/route.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
// Vercel 은 프록시 뒤에서 실행되므로 X-Forwarded-For 의 첫 IP 를 클라이언트 IP 로 사용
if (process.env.VERCEL) app.set('trust proxy', 1);

app.use(securityHeaders);
app.use('/api', sameOriginOnly);
app.use(express.json({ limit: '10kb' })); // 여행 조건만 받으므로 작게
// 로컬용 정적 파일 (Vercel 에서는 무시되고 public/ 을 CDN 이 제공)
app.use(express.static(path.join(__dirname, '..', 'public'), { dotfiles: 'deny' }));

// 과금 API: IP별 속도 제한 → (선택) 접근 코드 → 라우터
const planLimiter = rateLimit({ name: 'plan', windowMs: 10 * 60_000, max: env.limits.plansPerIpPer10Min });
const searchLimiter = rateLimit({ name: 'search', windowMs: 60_000, max: env.limits.searchPerIpPerMin });

// 키 값은 절대 포함하지 않고, 설정 여부와 오늘 사용량만 반환
app.get('/api/health', async (req, res, next) => {
  try {
    res.json({
      ok: true,
      missingEnv: missingEnv(),
      usage: await usageSummary(),
      usageStore: storeKind(),
      accessCodeRequired: accessCodeRequired(),
      webSearch: env.openai.webSearch,
    });
  } catch (err) { next(err); }
});
app.use('/api/config', configRouter); // 공개용 지도 Client ID만
app.use('/api/places', searchLimiter, requireAccessCode, placesRouter);
app.use('/api/plan', planLimiter, requireAccessCode, planRouter);
app.use('/api/route', searchLimiter, requireAccessCode, routeRouter);

app.use('/api', notFound);
app.use(errorHandler);

export default app;
