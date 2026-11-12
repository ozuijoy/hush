import { describe, expect, it } from 'vitest';
import { presign } from '../src/server/sigv4';

/**
 * AWS 官方文件「Authenticating Requests: Using Query Parameters」的範例，
 * 用來確認 canonical request 與簽章鏈完全符合 SigV4 規格。
 */
describe('SigV4 預簽名', () => {
  it('重現 AWS 文件的 GET 範例', async () => {
    const result = await presign({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      expiresIn: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });

    expect(result.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
        'host:examplebucket.s3.amazonaws.com',
        '',
        'host',
        'UNSIGNED-PAYLOAD',
      ].join('\n'),
    );
    expect(result.signature).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
    expect(result.url).toContain('X-Amz-Signature=');
  });

  it('把額外的 response-content-disposition 納入簽章', async () => {
    const plain = await presign({
      method: 'GET',
      host: 'bucket.example.com',
      path: '/hush/2026/a.pdf',
      region: 'us-west-004',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      expiresIn: 300,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    const withDisposition = await presign({
      method: 'GET',
      host: 'bucket.example.com',
      path: '/hush/2026/a.pdf',
      region: 'us-west-004',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      expiresIn: 300,
      now: new Date('2026-01-01T00:00:00Z'),
      extraQuery: { 'response-content-disposition': 'attachment; filename="a.pdf"' },
    });

    expect(withDisposition.signature).not.toBe(plain.signature);
    expect(withDisposition.url).toContain('response-content-disposition=');
    expect(withDisposition.canonicalRequest).toContain(
      'response-content-disposition=attachment%3B%20filename%3D%22a.pdf%22',
    );
  });
});