// 보안 헤더 정의 — Express(로컬)와 vercel.json(배포, 정적 파일)에서 같은 값을 사용합니다.
// 값을 바꾸면 `npm run sync:vercel` 로 vercel.json 을 갱신하세요. (`npm run check:deploy` 가 불일치를 잡아냄)

// NAVER 지도 SDK 는 페이지 프로토콜을 따라 http/https 로 리소스를 부르므로,
// 스킴 없이 호스트만 적어 "페이지와 같은 스킴(+https)"만 허용합니다.
const NAVER = 'oapi.map.naver.com *.map.naver.net *.naver.net *.pstatic.net';

export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${NAVER}`,
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net", // 인라인 style 속성(--cat 색상) 사용
  "font-src 'self' https://cdn.jsdelivr.net",
  `img-src 'self' data: blob: ${NAVER} *.naver.com *.navercorp.com`,
  `connect-src 'self' ${NAVER} *.naver.com *.navercorp.com`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
