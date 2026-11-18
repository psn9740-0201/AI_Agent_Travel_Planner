// 백엔드 API 호출 모음. 브라우저는 외부 API 키를 절대 다루지 않고, 우리 서버(/api/*)만 호출합니다.

// 접근 코드 (서버에 APP_ACCESS_CODE 가 설정된 경우만 사용). 탭을 닫으면 사라지는 sessionStorage 에 보관
const CODE_KEY = 'travel-access-code';
export const accessCode = {
  get() { try { return sessionStorage.getItem(CODE_KEY) ?? ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem(CODE_KEY, v); } catch { /* 저장 불가 환경 */ } },
  clear() { try { sessionStorage.removeItem(CODE_KEY); } catch { /* 무시 */ } },
};
const authHeaders = () => (accessCode.get() ? { 'X-Access-Code': accessCode.get() } : {});

function apiError(data, status) {
  const err = new Error(data.error || `요청에 실패했어요 (${status})`);
  err.status = status;
  err.code = data.code;
  return err;
}
async function request(url, { timeout = 30_000, ...options } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...options.headers },
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? '응답 시간이 너무 오래 걸려 요청을 중단했어요. 잠시 후 다시 시도해 주세요.'
      : '서버에 연결할 수 없어요. 네트워크 연결을 확인하고 잠시 후 다시 시도해 주세요.');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(data, res.status);
  return data;
}

// POST /api/plan — NDJSON 스트림을 한 줄씩 읽어 onEvent 로 전달하고, 최종 result 이벤트를 반환합니다.
async function streamPlan(trip, onEvent, { timeout = 240_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    let res;
    try {
      res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(trip),
        signal: ctrl.signal,
      });
    } catch {
      throw new Error('서버에 연결할 수 없어요. 네트워크 연결을 확인하고 잠시 후 다시 시도해 주세요.');
    }
    if (!res.ok) throw apiError(await res.json().catch(() => ({})), res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let result = null;
    const handle = (line) => {
      if (!line.trim()) return;
      const evt = JSON.parse(line);
      if (evt.type === 'error') throw new Error(evt.message);
      if (evt.type === 'result') result = evt;
      else onEvent(evt);
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(handle);
    }
    handle(buf);
    if (!result) throw new Error('응답이 중간에 끊겼어요. 다시 시도해 주세요.');
    return result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('응답 시간이 너무 오래 걸려 요청을 중단했어요. 잠시 후 다시 시도해 주세요.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  planStream: streamPlan, // Agent (Function Calling)
  health: () => request('/api/health', { timeout: 5_000 }),
  config: () => request('/api/config'),
  searchPlaces: ({ region, keyword, sort = 'comment' }) =>
    request(`/api/places?${new URLSearchParams({ region, keyword, sort })}`, { timeout: 15_000 }), // Level 1
  getRoute: (points) => request('/api/route', { method: 'POST', body: JSON.stringify({ points }) }), // NAVER Directions 5
};
