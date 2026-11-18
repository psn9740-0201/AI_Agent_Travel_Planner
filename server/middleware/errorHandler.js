export function notFound(req, res) {
  res.status(404).json({ error: 'Not Found' });
}

// 모든 오류를 JSON 으로 응답합니다. 내부 오류 내용(스택, 키 등)은 노출하지 않습니다.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error('[error]', req.method, req.path, err.message);
  // 스트리밍 응답이 이미 시작됐다면 연결만 정리
  if (res.headersSent) return res.end();
  res.status(status).json({
    error: err.expose ? err.message : '서버 오류가 발생했습니다.',
    ...(err.code && err.expose ? { code: err.code } : {}),
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}
