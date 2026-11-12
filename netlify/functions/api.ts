/**
 * Netlify Functions（v2）入口。
 *
 * `config.path` 讓函式直接掛在 /api/*，前端與 API 同源。
 * Netlify 以 esbuild 打包此檔，會一併把 src/server 的共用程式碼打包進去。
 */
import { createApp } from '../../src/server/app';

const app = createApp();

export default async function handler(request: Request): Promise<Response> {
  return app.fetch(request, process.env as Record<string, string | undefined>);
}

export const config = {
  path: '/api/*',
};