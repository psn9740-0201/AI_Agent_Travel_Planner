// Vercel 진입점 — Vercel 은 루트의 app.js 에서 Express 앱(default export)을 찾아 하나의 Function 으로 실행합니다.
// 로컬 실행은 server/index.js (npm run dev)를 사용하세요.
import app from './server/app.js';

export default app;
