/**
 * 単体テスト: PDF命名ロジック
 * 社会保険取得通知書のファイル名生成パターンをテスト
 */

import { describe, it, expect } from 'vitest';
import {
  generatePdfFileName,
  generateIndividualPdfFileName,
  generateSafePdfFileName,
  sanitizeFileName,
} from './naming';
import type { NamingInfo } from '../xml/extractor';

describe('generatePdfFileName', () => {
  describe('取得・喪失の場合', () => {
    it('被保険者が1名の場合、「被保険者名様_通知書名.pdf」形式で生成する', () => {
      const info: NamingInfo = {
        firstInsurerName: '田名網　亜衣子',
        insurerCount: 1,
        allInsurers: [{ name: '田名網　亜衣子' }],
        noticeTitle: '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書',
      };

      const result = generatePdfFileName('取得', info);

      expect(result).toBe('田名網　亜衣子様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
    });

    it('被保険者が複数の場合、「被保険者名様他○名_通知書名.pdf」形式で生成する', () => {
      const info: NamingInfo = {
        firstInsurerName: '山田　太郎',
        insurerCount: 3,
        allInsurers: [
          { name: '山田　太郎' },
          { name: '鈴木　花子' },
          { name: '佐藤　次郎' },
        ],
        noticeTitle: '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書',
      };

      const result = generatePdfFileName('取得', info);

      expect(result).toBe('山田　太郎様他2名_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
    });

    it('被保険者名が取得できない場合、通知書名のみで生成する', () => {
      const info: NamingInfo = {
        insurerCount: 0,
        noticeTitle: '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書',
      };

      const result = generatePdfFileName('取得', info);

      expect(result).toBe('健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
    });

    it('喪失の場合も同様に「被保険者名様_通知書名.pdf」形式で生成する', () => {
      const info: NamingInfo = {
        firstInsurerName: '退職　太郎',
        insurerCount: 1,
        allInsurers: [{ name: '退職　太郎' }],
        noticeTitle: '健康保険・厚生年金保険資格喪失確認通知書',
      };

      const result = generatePdfFileName('喪失', info);

      expect(result).toBe('退職　太郎様_健康保険・厚生年金保険資格喪失確認通知書.pdf');
    });
  });

  describe('月額変更の場合', () => {
    it('適用年月がある場合、「適用年月_通知書名.pdf」形式で生成する', () => {
      const info: NamingInfo = {
        firstInsurerName: '改定　太郎',
        insurerCount: 2,
        applicableDate: 'R07年09月',
        noticeTitle: '健康保険・厚生年金保険被保険者標準報酬改定通知書',
      };

      const result = generatePdfFileName('月額変更', info);

      expect(result).toBe('R07年09月_健康保険・厚生年金保険被保険者標準報酬改定通知書.pdf');
    });

    it('適用年月がなく改定年月がある場合、改定年月で代替する', () => {
      const info: NamingInfo = {
        firstInsurerName: '改定　花子',
        insurerCount: 1,
        revisionDate: 'R07年11月',
        noticeTitle: '健康保険・厚生年金保険被保険者標準報酬改定通知書',
      };

      const result = generatePdfFileName('月額変更', info);

      expect(result).toBe('R07年11月_健康保険・厚生年金保険被保険者標準報酬改定通知書.pdf');
    });

    it('日付情報がない場合、通知書名のみで生成する', () => {
      const info: NamingInfo = {
        firstInsurerName: '改定　次郎',
        insurerCount: 1,
        noticeTitle: '健康保険・厚生年金保険被保険者標準報酬改定通知書',
      };

      const result = generatePdfFileName('月額変更', info);

      expect(result).toBe('健康保険・厚生年金保険被保険者標準報酬改定通知書.pdf');
    });

    it('70歳以上被用者月額改定の場合も改定年月を使用する', () => {
      const info: NamingInfo = {
        firstInsurerName: '高齢　改定',
        insurerCount: 1,
        revisionDate: 'R07年11月',
        noticeTitle: '厚生年金保険70歳以上被用者標準報酬月額相当額改定のお知らせ',
      };

      const result = generatePdfFileName('月額変更', info);

      expect(result).toBe('R07年11月_厚生年金保険70歳以上被用者標準報酬月額相当額改定のお知らせ.pdf');
    });
  });

  describe('その他の場合', () => {
    it('通知書名のみで生成する', () => {
      const info: NamingInfo = {
        firstInsurerName: '一般　太郎',
        insurerCount: 1,
        noticeTitle: 'その他の通知書',
      };

      const result = generatePdfFileName('その他', info);

      expect(result).toBe('その他の通知書.pdf');
    });
  });

  describe('表紙（kagami）の場合', () => {
    it('表紙.pdfを生成する', () => {
      const info: NamingInfo = {
        insurerCount: 0,
        noticeTitle: '日本年金機構からのお知らせ',
      };

      const result = generatePdfFileName('その他', info);

      expect(result).toBe('表紙.pdf');
    });
  });
});

describe('generateIndividualPdfFileName', () => {
  it('取得の場合、「被保険者名様_通知書名.pdf」形式で生成する', () => {
    const result = generateIndividualPdfFileName(
      '取得',
      '田名網　亜衣子',
      '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書'
    );

    // sanitizeFileNameが連続する空白を1つにまとめるため、全角スペースも半角スペース1つになる
    expect(result).toBe('田名網 亜衣子様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
  });

  it('喪失の場合、「被保険者名様_通知書名.pdf」形式で生成する', () => {
    const result = generateIndividualPdfFileName(
      '喪失',
      '退職　太郎',
      '健康保険・厚生年金保険資格喪失確認通知書'
    );

    // sanitizeFileNameが連続する空白を1つにまとめるため、全角スペースも半角スペース1つになる
    expect(result).toBe('退職 太郎様_健康保険・厚生年金保険資格喪失確認通知書.pdf');
  });

  it('その他の場合、通知書名のみで生成する', () => {
    const result = generateIndividualPdfFileName(
      'その他',
      '一般　太郎',
      'その他の通知書'
    );

    expect(result).toBe('その他の通知書.pdf');
  });

  it('不正な文字を含む被保険者名もサニタイズされる', () => {
    const result = generateIndividualPdfFileName(
      '取得',
      '田中/太郎',
      '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書'
    );

    expect(result).toBe('田中／太郎様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
  });
});

describe('sanitizeFileName', () => {
  it('OSで禁止されている文字を全角に置換する', () => {
    const testCases = [
      { input: 'file/name.pdf', expected: 'file／name.pdf' },
      { input: 'file\\name.pdf', expected: 'file＼name.pdf' },
      { input: 'file:name.pdf', expected: 'file：name.pdf' },
      { input: 'file*name.pdf', expected: 'file＊name.pdf' },
      { input: 'file?name.pdf', expected: 'file？name.pdf' },
      { input: 'file"name.pdf', expected: 'file"name.pdf' },
      { input: 'file<name.pdf', expected: 'file＜name.pdf' },
      { input: 'file>name.pdf', expected: 'file＞name.pdf' },
      { input: 'file|name.pdf', expected: 'file｜name.pdf' },
    ];

    testCases.forEach(({ input, expected }) => {
      expect(sanitizeFileName(input)).toBe(expected);
    });
  });

  it('連続する空白を1つにまとめる', () => {
    const result = sanitizeFileName('file   name.pdf');
    expect(result).toBe('file name.pdf');
  });

  it('先頭・末尾の空白を削除する', () => {
    const result = sanitizeFileName('  filename.pdf  ');
    expect(result).toBe('filename.pdf');
  });

  it('空のファイル名の場合、デフォルト名を返す', () => {
    expect(sanitizeFileName('')).toBe('通知書.pdf');
    expect(sanitizeFileName('   ')).toBe('通知書.pdf');
    expect(sanitizeFileName('.pdf')).toBe('通知書.pdf');
  });

  it('複数の置換を組み合わせて処理できる', () => {
    const result = sanitizeFileName('  田中/太郎:  山田  花子.pdf  ');
    expect(result).toBe('田中／太郎： 山田 花子.pdf');
  });
});

describe('generateSafePdfFileName', () => {
  it('ファイル名生成とサニタイズを同時に行う', () => {
    const info: NamingInfo = {
      firstInsurerName: '田中/太郎',
      insurerCount: 1,
      allInsurers: [{ name: '田中/太郎' }],
      noticeTitle: '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書',
    };

    const result = generateSafePdfFileName('取得', info);

    expect(result).toBe('田中／太郎様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
  });

  it('月額変更の場合もサニタイズを行う', () => {
    const info: NamingInfo = {
      firstInsurerName: '改定　太郎',
      insurerCount: 2,
      revisionDate: 'R07年11月',
      noticeTitle: '健康保険・厚生年金保険被保険者標準報酬改定通知書',
    };

    const result = generateSafePdfFileName('月額変更', info);

    expect(result).toBe('R07年11月_健康保険・厚生年金保険被保険者標準報酬改定通知書.pdf');
  });
});
