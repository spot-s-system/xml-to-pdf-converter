import { describe, expect, it } from 'vitest';
import {
  isAllowedOpenerOrigin,
  isHandoffFileMessage,
  parseContentDispositionFileName,
  sanitizeHandoffFileName,
} from '@/lib/opener-handoff';

describe('isAllowedOpenerOrigin', () => {
  it('spot-s-admin の本番・プレビュー・ローカルを許可する', () => {
    expect(isAllowedOpenerOrigin('https://spot-s-admin.vercel.app')).toBe(true);
    expect(isAllowedOpenerOrigin('https://spot-s-admin-git-feat-x-spot-s-system.vercel.app')).toBe(true);
    expect(isAllowedOpenerOrigin('http://localhost:3001')).toBe(true);
  });

  it('それ以外の origin は拒否する', () => {
    expect(isAllowedOpenerOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOpenerOrigin('https://spot-s-admin.vercel.app.evil.com')).toBe(false);
    expect(isAllowedOpenerOrigin('http://spot-s-admin.vercel.app')).toBe(false);
    expect(isAllowedOpenerOrigin('https://other-app.vercel.app')).toBe(false);
  });
});

describe('isHandoffFileMessage', () => {
  it('type・fileName・ArrayBuffer がそろったメッセージだけを受け付ける', () => {
    expect(
      isHandoffFileMessage({ type: 'xml-to-pdf:file', fileName: 'a.zip', data: new ArrayBuffer(1) })
    ).toBe(true);
    expect(isHandoffFileMessage({ type: 'xml-to-pdf:file', fileName: 'a.zip', data: 'x' })).toBe(false);
    expect(isHandoffFileMessage({ type: 'other', fileName: 'a.zip', data: new ArrayBuffer(1) })).toBe(false);
    expect(isHandoffFileMessage(null)).toBe(false);
  });
});

describe('parseContentDispositionFileName', () => {
  it('/api/download の UTF-8 ファイル名を復元する', () => {
    const name = '公文書_123_変換結果.zip';
    expect(
      parseContentDispositionFileName(`attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
    ).toBe(name);
    expect(parseContentDispositionFileName('attachment; filename="a.zip"')).toBe('a.zip');
    expect(parseContentDispositionFileName(null)).toBe(null);
  });
});

describe('sanitizeHandoffFileName', () => {
  it('パス区切り等を置換し、拡張子 .zip をそろえる', () => {
    expect(sanitizeHandoffFileName('公文書_123.zip')).toBe('公文書_123.zip');
    expect(sanitizeHandoffFileName('../a/b')).toBe('.._a_b.zip');
    expect(sanitizeHandoffFileName('')).toBe('koubunsho.zip');
  });
});
