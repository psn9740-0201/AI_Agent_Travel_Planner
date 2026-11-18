// 로컬 실행 진입점: npm run dev / npm start
import app from './app.js';
import { env, missingEnv } from './config/env.js';
import { usageSummary, storeKind } from './security/usageGuard.js';

app.listen(env.port, env.host, async () => {
  console.log(`✈️  Travel Planner: http://localhost:${env.port}  (바인딩: ${env.host})`);
  if (env.host !== '127.0.0.1' && env.host !== 'localhost') {
    console.warn('⚠️  HOST가 외부에 열려 있습니다. 같은 네트워크의 누구나 접속해 API 비용을 발생시킬 수 있어요.');
  }
  const missing = missingEnv();
  if (missing.length) console.warn(`⚠️  .env 미설정 항목: ${missing.join(', ')}`);
  try {
    const u = await usageSummary();
    console.log(`📊 오늘 사용량 [${storeKind()}]: 일정 ${u.plans.used}/${u.plans.limit} · 토큰 ${u.tokens.used.toLocaleString()}/${u.tokens.limit.toLocaleString()} · 검색 ${u.naverSearch.used}/${u.naverSearch.limit} · 길찾기 ${u.naverDirections.used}/${u.naverDirections.limit}`);
  } catch (err) {
    console.warn('⚠️  사용량 저장소 확인 실패:', err.message);
  }
});
