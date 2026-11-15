/**
 * Hono 的共用情境型別。
 */
import type { Context } from 'hono';
import type { Config } from './config';
import type { Outbound } from './outbound';
import type { SessionUser, Sql } from './types';

export type AppBindings = {
  Bindings: Record<string, string | undefined>;
  Variables: {
    db: Sql;
    config: Config;
    user: SessionUser;
    outbound: Outbound;
  };
};

export type AppContext = Context<AppBindings>;