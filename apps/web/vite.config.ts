import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * The PayGuard API sends no CORS headers and issues a SameSite=Strict session cookie, so the
 * browser must reach it same-origin. In dev Vite proxies /v1 and /health to the API; in
 * production `server.mjs` does the same. The browser's own Origin header is forwarded untouched,
 * which is what the API checks against API_ALLOWED_ORIGINS.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.PAYGUARD_API_URL ?? 'http://127.0.0.1:3000';
  const port = Number.parseInt(env.WEB_PORT ?? '5173', 10);
  const proxy = {
    '/v1': { target, changeOrigin: false },
    '/health': { target, changeOrigin: false },
  };
  return {
    plugins: [react()],
    server: { host: 'localhost', port, strictPort: true, proxy },
    build: { target: 'es2022', sourcemap: true },
  };
});
