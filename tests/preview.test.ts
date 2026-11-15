import { describe, expect, it } from 'vitest';
import { previewInfo, TEXT_PREVIEW_LIMIT } from '../src/shared/preview';
import { S3Storage } from '../src/server/storage/s3';

describe('previewInfo', () => {
  it('圖片、音訊、影片、PDF 依 MIME 或副檔名判斷', () => {
    expect(previewInfo('a.jpg', 'image/jpeg')).toEqual({ kind: 'image', contentType: 'image/jpeg' });
    expect(previewInfo('a.PNG', 'application/octet-stream')?.kind).toBe('image');
    expect(previewInfo('voice.m4a', '')).toEqual({ kind: 'audio', contentType: 'audio/mp4' });
    expect(previewInfo('x', 'audio/mpeg')?.kind).toBe('audio');
    expect(previewInfo('clip.mov', '')?.kind).toBe('video');
    expect(previewInfo('報告.pdf', '')).toEqual({ kind: 'pdf', contentType: 'application/pdf' });
  });

  it('SVG、HTML 只能以純文字預覽；壓縮檔與過大的文字不能預覽', () => {
    expect(previewInfo('logo.svg', 'image/svg+xml')?.contentType).toBe('text/plain; charset=utf-8');
    expect(previewInfo('fake.png', 'image/svg+xml')).toBeNull();
    expect(previewInfo('index.html', 'text/html')?.kind).toBe('text');
    expect(previewInfo('a.zip', 'application/zip')).toBeNull();
    expect(previewInfo('big.log', 'text/plain', TEXT_PREVIEW_LIMIT + 1)).toBeNull();
    expect(previewInfo('evil', 'audio/x"><script>')).toBeNull();
  });
});

describe('S3Storage 預覽網址', () => {
  const storage = new S3Storage({
    endpoint: 'https://storage.example.com',
    region: 'us-test-1',
    bucket: 'test-bucket',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret',
    forcePathStyle: true,
    prefix: '',
  });
  const file = { id: 'f1', name: '照片.jpg', mime: 'image/jpeg', sizeBytes: 10, storageKey: 'f1/photo.jpg' };

  it('預覽：inline、覆寫 Content-Type、效期 1 小時', async () => {
    const target = await storage.downloadTarget(file, previewInfo(file.name, file.mime));
    const url = new URL(target.url);
    expect(target.inline).toBe(true);
    expect(url.pathname).toBe('/test-bucket/f1/photo.jpg');
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^inline;/);
    expect(url.searchParams.get('response-content-type')).toBe('image/jpeg');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
  });

  it('下載：維持 attachment、5 分鐘', async () => {
    const target = await storage.downloadTarget(file);
    const url = new URL(target.url);
    expect(target.inline).toBe(false);
    expect(url.searchParams.get('response-content-disposition')).toMatch(/^attachment;/);
    expect(url.searchParams.get('response-content-type')).toBeNull();
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });
});
