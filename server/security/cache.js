// 간단한 TTL 메모리 캐시 — 같은 검색·경로를 반복 호출하지 않아 과금을 줄입니다.
export function createCache({ ttlMs, max = 500 }) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      if (store.size >= max) store.delete(store.keys().next().value); // 가장 오래된 항목 제거
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
  };
}
