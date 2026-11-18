// 키 유출 검사 — 커밋/배포 전에 실행: npm run check:secrets
// 1) .env 의 실제 비밀 값이 다른 파일에 들어가 있지 않은지
// 2) OpenAI 키 형태(sk-...) 문자열이 코드에 없는지
// 3) .env 가 .gitignore 로 보호되는지 / git 에 추적되고 있지 않은지
// 발견된 값 자체는 출력하지 않습니다.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'data']);
const SKIP_FILES = new Set(['.env', 'package-lock.json']);
const problems = [];

// .env 값 읽기 (dotenv 를 쓰지 않고 직접 파싱 — 값을 메모리에서만 사용)
const secrets = [];
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    const value = raw.replace(/^["']|["']$/g, '');
    if (/KEY|SECRET|CLIENT_ID/.test(key) && value.length >= 8) secrets.push({ key, value });
  }
} catch { /* .env 없음 */ }

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    if (SKIP_FILES.has(entry.name) || /\.(png|jpe?g|gif|ico|woff2?)$/i.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    const rel = path.relative(ROOT, file);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const s of secrets) if (text.includes(s.value)) problems.push(`${rel}: ${s.key} 값이 들어 있습니다`);
    if (/\bsk-(proj-)?[A-Za-z0-9_-]{20,}/.test(text)) problems.push(`${rel}: OpenAI 키 형태의 문자열이 있습니다`);
  }
}
walk(ROOT);

const gitignore = fs.existsSync(path.join(ROOT, '.gitignore')) ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8') : '';
if (!/^\.env$/m.test(gitignore)) problems.push('.gitignore 에 .env 가 없습니다');
try {
  const tracked = execSync('git ls-files', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n');
  if (tracked.some((f) => /(^|\/)\.env$/.test(f))) problems.push('.env 가 git 에 추적되고 있습니다 → git rm --cached .env');
} catch { /* git 저장소 아님 */ }

if (process.platform !== 'win32') {
  try {
    const mode = fs.statSync(path.join(ROOT, '.env')).mode & 0o777;
    if (mode & 0o077) problems.push(`.env 권한이 ${mode.toString(8)} 입니다 → chmod 600 .env 권장`);
  } catch { /* 없음 */ }
}

if (problems.length) {
  console.error('❌ 보안 점검 실패');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✅ 보안 점검 통과 (비밀 값 ${secrets.length}개 기준으로 검사)`);
