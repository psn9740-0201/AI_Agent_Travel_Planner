// 카운터 저장소 — 사용량 한도·속도 제한·동시 실행 수에 사용
//
// - Upstash Redis(REST) 환경변수가 있으면 Redis 를 사용합니다. (Vercel 처럼 인스턴스가 여러 개인 환경에서 필수)
//     KV_REST_API_URL / KV_REST_API_TOKEN          ← Vercel Marketplace 의 Upstash 연동 시 자동 등록
//     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// - 없으면 메모리를 사용하고, 로컬에서는 일일 사용량을 data/usage.json 에 저장합니다.
//   (Vercel 에서는 파일 쓰기가 불가하고 인스턴스마다 메모리가 따로라 한도가 정확하지 않음 → Redis 권장)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
const REDIS_TOKEN = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const ON_VERCEL = Boolean(process.env.VERCEL);

// ── Redis (Upstash REST) ──────────────────────
function redisStore() {
  async function pipeline(commands) {
    const res = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`사용량 저장소 오류 (HTTP ${res.status})`);
    const out = await res.json();
    const err = out.find((r) => r.error);
    if (err) throw new Error(`사용량 저장소 오류: ${err.error}`);
    return out.map((r) => r.result);
  }
  return {
    kind: 'redis',
    async incr(key, by, ttlSec) {
      const [value] = await pipeline([['INCRBY', key, by], ['EXPIRE', key, ttlSec]]);
      return Number(value);
    },
    async get(key) {
      const [value] = await pipeline([['GET', key]]);
      return Number(value ?? 0);
    },
    async getMany(keys) {
      if (!keys.length) return [];
      const [values] = await pipeline([['MGET', ...keys]]);
      return values.map((v) => Number(v ?? 0));
    },
  };
}

// ── 메모리 (+ 로컬 파일 저장) ───────────────────
function memoryStore() {
  const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
  const FILE = path.join(DATA_DIR, 'usage.json');
  const PERSIST = !ON_VERCEL; // Vercel 은 파일 시스템이 읽기 전용
  const map = new Map(); // key → { value, expires }

  if (PERSIST) {
    try {
      const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (saved.date && saved.counts) {
        // 이전 형식 { date, counts } → usage:{date}:{name} 로 변환
        const expires = Date.now() + 2 * 24 * 60 * 60 * 1000;
        for (const [name, value] of Object.entries(saved.counts)) map.set(`usage:${saved.date}:${name}`, { value, expires });
      } else {
        for (const [k, v] of Object.entries(saved)) if (v.expires > Date.now()) map.set(k, v);
      }
    } catch { /* 처음 실행 */ }
  }

  let timer = null;
  let dirty = false;
  const flush = () => {
    clearTimeout(timer);
    if (!PERSIST || !dirty) return;
    try {
      // 일일 사용량(usage:*)만 저장 — 속도 제한·실행 중 카운터는 재시작 시 초기화
      const obj = Object.fromEntries([...map].filter(([k, v]) => k.startsWith('usage:') && v.expires > Date.now()));
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(FILE, JSON.stringify(obj), { mode: 0o600 });
      dirty = false;
    } catch (err) {
      console.error('[usage] 저장 실패:', err.message);
    }
  };
  if (PERSIST) {
    process.on('exit', flush);
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { flush(); process.exit(0); });
  }

  const read = (key) => {
    const e = map.get(key);
    if (!e) return 0;
    if (e.expires < Date.now()) { map.delete(key); return 0; }
    return e.value;
  };
  return {
    kind: ON_VERCEL ? 'memory (인스턴스별 — Redis 권장)' : 'memory + data/usage.json',
    async incr(key, by, ttlSec) {
      const value = read(key) + by;
      map.set(key, { value, expires: Date.now() + ttlSec * 1000 });
      if (key.startsWith('usage:')) {
        dirty = true;
        clearTimeout(timer);
        timer = setTimeout(flush, 200);
      }
      return value;
    },
    async get(key) { return read(key); },
    async getMany(keys) { return keys.map(read); },
  };
}

export const store = REDIS_URL && REDIS_TOKEN ? redisStore() : memoryStore();

if (ON_VERCEL && store.kind !== 'redis') {
  console.warn('⚠️  Vercel 에서 공유 사용량 저장소(Upstash Redis)가 설정되지 않았습니다. 일일 한도·속도 제한이 인스턴스마다 따로 계산됩니다.');
}
