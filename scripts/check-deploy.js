// 배포 전 점검: npm run check:deploy
// 1) 비밀 정보 유출 검사  2) Git/Vercel 업로드 제외 설정  3) vercel.json 보안 헤더 동기화  4) Vercel 진입점
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildVercelConfig } from './sync-vercel.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
const results = [];
const check = (name, ok, hint = '') => results.push({ name, ok, hint });

// 1) 비밀 정보
try {
  execSync('node scripts/check-secrets.js', { cwd: ROOT, stdio: 'pipe' });
  check('비밀 값이 코드에 없음 / .env 권한', true);
} catch (e) {
  check('비밀 값이 코드에 없음 / .env 권한', false, e.stdout.toString().trim() + e.stderr.toString().trim());
}

// 2) 업로드 제외
check('.gitignore 에 .env', /^\.env$/m.test(read('.gitignore')));
check('.vercelignore 에 .env', /^\.env$/m.test(read('.vercelignore')), '.vercelignore 를 만들고 .env 를 추가하세요');
try {
  execSync('git check-ignore -q .env', { cwd: ROOT });
  check('git 이 .env 를 무시함', true);
} catch {
  check('git 이 .env 를 무시함', !fs.existsSync(path.join(ROOT, '.git')), 'git check-ignore .env 결과 확인');
}
try {
  const staged = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT }).toString().split('\n').filter(Boolean);
  const bad = staged.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example') || f.startsWith('data/') || f.startsWith('node_modules/'));
  check('git 업로드 대상에 .env·data·node_modules 없음', bad.length === 0, bad.join(', '));
} catch { /* git 저장소 아님 */ }

// 3) vercel.json
let vercel = null;
try { vercel = JSON.parse(read('vercel.json')); } catch { /* 없음 */ }
check('vercel.json 보안 헤더가 서버와 동일', vercel && JSON.stringify(vercel.headers) === JSON.stringify(buildVercelConfig().headers), 'npm run sync:vercel 실행');

// 4) Vercel 진입점 (루트 app.js 가 Express 앱을 default export)
try {
  process.env.VERCEL_CHECK = '1';
  const mod = await import(path.join(ROOT, 'app.js'));
  check('루트 app.js 가 Express 앱을 export', typeof mod.default === 'function' && typeof mod.default.use === 'function');
} catch (e) {
  check('루트 app.js 가 Express 앱을 export', false, e.message);
}

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${!r.ok && r.hint ? `\n   → ${r.hint}` : ''}`);
  if (!r.ok) failed++;
}
console.log(failed ? `\n${failed}개 항목을 해결한 뒤 배포하세요.` : '\n배포 준비 완료');
process.exit(failed ? 1 : 0);
