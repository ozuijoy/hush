import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/server/crypto';

describe('密碼雜湊', () => {
  it('使用 PBKDF2 且每次加鹽不同', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');

    expect(first.startsWith('pbkdf2-sha256$100000$')).toBe(true);
    expect(first).not.toBe(second);
    expect(await verifyPassword('correct horse battery staple', first)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', first)).toBe(false);
  });

  it('拒絕格式錯誤的雜湊值', async () => {
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$0$aaaa$bbbb')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$100000$%%%%$bbbb')).toBe(false);
  });
});