// server/security/headers.js 의 보안 헤더로 vercel.json 을 생성합니다.
// Vercel 에서는 public/ 정적 파일을 CDN 이 직접 제공하므로, Express 가 붙이는 헤더가 적용되지 않습니다.
// 실행: npm run sync:vercel
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECURITY_HEADERS } from '../server/security/headers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export function buildVercelConfig() {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    headers: [
      { source: '/(.*)', headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })) },
      { source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'vercel.json'), `${JSON.stringify(buildVercelConfig(), null, 2)}\n`);
  console.log('✅ vercel.json 갱신');
}
