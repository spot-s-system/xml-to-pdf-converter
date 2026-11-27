import { describe, it, expect } from 'vitest';
import {
  detectFixedNameFromPdfText,
  isArrivalNumberPdfFileName,
} from '../lib/pdf-title-detector';

describe('isArrivalNumberPdfFileName', () => {
  it('18桁の到達番号.pdf だけを対象にする', () => {
    expect(isArrivalNumberPdfFileName('202611131552311521.pdf')).toBe(true);
    expect(isArrivalNumberPdfFileName('202611131552311521.PDF')).toBe(true);
    expect(isArrivalNumberPdfFileName('7100001.pdf')).toBe(false);
    expect(isArrivalNumberPdfFileName('202611131552311521-0001_通知書.pdf')).toBe(false);
    expect(isArrivalNumberPdfFileName('202611131552311521.xml')).toBe(false);
  });
});

describe('detectFixedNameFromPdfText', () => {
  it('字間が空いた「名称、所在地等変更届」の受付控えを判定する', () => {
    // 労働局の受付控えPDF（pdfjs 抽出）は字間に空白が入る
    const text =
      '到達番号:200001010000000000 受付番号:200001010000000001 受付(電子申請) ' +
      '令和08年1月1日 東京労働局 様式第2号 （第5条関係） 労働保険 名 称 、 所 在 地 等 変 更 届 種 別';
    expect(detectFixedNameFromPdfText(text)).toBe('労働保険名称所在地変更届.pdf');
  });

  it('保険関係成立届を判定する', () => {
    expect(detectFixedNameFromPdfText('様式第1号 労働保険 保 険 関 係 成 立 届 （継続）')).toBe(
      '労働保険関係成立届.pdf'
    );
  });

  it('概算・確定保険料申告書と概算保険料申告書を区別する', () => {
    expect(detectFixedNameFromPdfText('労働保険 概算・確定保険料 申告書')).toBe(
      '労働保険概算・確定保険料申告書.pdf'
    );
    expect(detectFixedNameFromPdfText('労働保険 概算保険料申告書 （継続）')).toBe(
      '労働保険概算保険料申告書.pdf'
    );
  });

  it('冒頭に無い語（本文後半の注記）にはマッチしない', () => {
    const text = 'お知らせ '.repeat(200) + '保険関係成立届';
    expect(detectFixedNameFromPdfText(text)).toBeNull();
  });

  it('該当しない帳票は null', () => {
    expect(detectFixedNameFromPdfText('健康保険・厚生年金保険 資格取得確認通知書')).toBeNull();
    expect(detectFixedNameFromPdfText('')).toBeNull();
  });
});
