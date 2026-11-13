import { describe, expect, it } from 'vitest';
import { PG_UPLOAD_LIMIT, loadConfig } from '../src/server/config';

describe('loadConfig', () => {
  it('SESSION_DAYS 無效時回到預設 30 天', () => {
    expect(loadConfig({ SESSION_DAYS: 'abc' }).sessionDays).toBe(30);
    expect(loadConfig({ SESSION_DAYS: '0' }).sessionDays).toBe(30);
    expect(loadConfig({ SESSION_DAYS: '7' }).sessionDays).toBe(7);
  });

  it('沒有 S3 設定時自動使用 Postgres 直存，並套用 4 MB 上限', () => {
    const config = loadConfig({ MAX_UPLOAD_MB: '500' });
    expect(config.storageDriver).toBe('pg');
    expect(config.s3).toBeNull();
    expect(config.maxUploadBytes).toBe(PG_UPLOAD_LIMIT);
  });

  it('S3 設定齊全時使用 S3，並套用 MAX_UPLOAD_MB', () => {
    const config = loadConfig({
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      S3_ENDPOINT: 'https://s3.example.com///',
      MAX_UPLOAD_MB: '20',
    });
    expect(config.storageDriver).toBe('s3');
    expect(config.s3?.endpoint).toBe('https://s3.example.com');
    expect(config.s3?.prefix).toBe('hush/');
    expect(config.maxUploadBytes).toBe(20 * 1024 * 1024);
  });
});
