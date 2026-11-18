// 보안 미들웨어 (외부 패키지 없이 구현)
import crypto from 'node:crypto';
import { HttpError } from './errorHandler.js';
import { SECURITY_HEADERS } from '../security/headers.js';
import { store } from '../security/store.js';

// ── 보안 헤더 (Vercel 의 정적 파일에는 vercel.json 의 headers 가 적용됨) ──
export function securityHeaders(req, res, next) {
  res.set(SECURITY_HEADERS);
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
}

// ── 다른 사이트에서의 API 호출 차단 ──────────────
// 브라우저는 교차 출처 요청에 Origin 헤더를 붙입니다. 요청받은 호스트와 다르면 거부합니다.
// (로컬·Vercel 배포 도메인 모두 자동으로 같은 출처로 인정 / 추가 허용: ALLOWED_ORIGINS)
const extraOrigins = new Set((process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean));

export function sameOriginOnly(req, res, next) {
  const origin = req.get('origin');
  if (origin && !extraOrigins.has(origin)) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* 잘못된 Origin */ }
    const host = req.get('x-forwarded-host') || req.get('host');
    if (!originHost || originHost !== host) return next(new HttpError(403, '허용되지 않은 출처의 요청입니다.'));
  }
  if (req.method === 'POST' && !req.is('application/json')) return next(new HttpError(415, 'JSON 요청만 허용됩니다.'));
  next();
}

// ── 접근 코드 (선택) ───────────────────────────
// APP_ACCESS_CODE 가 설정되면, 과금 API 는 헤더 X-Access-Code 가 일치해야 호출됩니다.
const ACCESS_CODE = (process.env.APP_ACCESS_CODE ?? '').trim();
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const CODE_DIGEST = ACCESS_CODE ? digest(ACCESS_CODE) : null;

export const accessCodeRequired = () => Boolean(CODE_DIGEST);

export function requireAccessCode(req, res, next) {
  if (!CODE_DIGEST) return next();
  const given = req.get('x-access-code') ?? '';
  // 길이와 무관한 상수 시간 비교 (해시 비교)
  if (given && crypto.timingSafeEqual(digest(given), CODE_DIGEST)) return next();
  const err = new HttpError(401, given ? '접근 코드가 올바르지 않습니다.' : '접근 코드가 필요합니다.');
  err.code = 'ACCESS_CODE_REQUIRED';
  next(err);
}

// ── IP별 요청 속도 제한 (고정 윈도, 공유 저장소 사용) ──────────
export function rateLimit({ name, windowMs, max, message }) {
  const windowSec = Math.ceil(windowMs / 1000);
  return async (req, res, next) => {
    if (max === 0) return next(new HttpError(429, '이 기능은 현재 비활성화되어 있습니다.'));
    const slot = Math.floor(Date.now() / windowMs);
    const key = `rl:${name}:${req.ip}:${slot}`;
    try {
      const count = await store.incr(key, 1, windowSec);
      res.set('RateLimit-Remaining', String(Math.max(0, max - count)));
      if (count > max) {
        const retry = Math.ceil(((slot + 1) * windowMs - Date.now()) / 1000);
        res.set('Retry-After', String(retry));
        return next(new HttpError(429, message ?? `요청이 너무 많아요. ${Math.max(1, Math.ceil(retry / 60))}분 후 다시 시도해 주세요.`));
      }
      next();
    } catch (err) {
      console.error('[rate-limit]', err.message);
      next(new HttpError(503, '요청 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.')); // fail-closed
    }
  };
}
