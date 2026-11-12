/**
 * Cloudflare Pages Functions 入口。
 *
 * 專案結構約定 `functions/api/[[path]].ts` 會攔截所有 /api/* 請求，
 * 因此前端與 API 同源，不需要 CORS，也不需要 Cloudflare Workers。
 */
import { createApp } from '../../src/server/app';

interface PagesContext {
  request: Request;
  env: Record<string, string | undefined>;
}

const app = createApp();

export const onRequest = (context: PagesContext): Response | Promise<Response> =>
  app.fetch(context.request, context.env);