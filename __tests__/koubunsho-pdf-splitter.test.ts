import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import {
  isShahoKoubunshoPdfFileName,
  getNoticeTitleFromPdfFileName,
  extractInsurerNameFromItems,
  splitShahoKoubunshoPdf,
} from '@/lib/koubunsho-pdf-splitter';

describe('isShahoKoubunshoPdfFileName — 社保公文書PDF判定', () => {
  it.each([
    ['7100001.pdf', true],
    ['7120002.pdf', true],
    ['7130001.pdf', true],
    ['7140001.pdf', true],
    ['7150001.pdf', true],
    ['7170003.pdf', true],
    ['7200001.pdf', true],
    ['7210001.pdf', true],
    ['7220001.pdf', true],
  ] as const)('%s → %s', (fileName, expected) => {
    expect(isShahoKoubunshoPdfFileName(fileName)).toBe(expected);
  });

  it('7012001 (新規適用; 会社単位) は対象外', () => {
    expect(isShahoKoubunshoPdfFileName('7012001.pdf')).toBe(false);
  });

  it('未知の通知書IDは対象外', () => {
    expect(isShahoKoubunshoPdfFileName('7999999.pdf')).toBe(false);
  });

  it('PDFでないファイルは対象外', () => {
    expect(isShahoKoubunshoPdfFileName('7150001.xml')).toBe(false);
    expect(isShahoKoubunshoPdfFileName('7150001.txt')).toBe(false);
  });

  it('数字前にプレフィックスがあるものは対象外', () => {
    expect(isShahoKoubunshoPdfFileName('foo_7150001.pdf')).toBe(false);
  });

  it('社保公文書PDFでないファイル名は対象外', () => {
    expect(isShahoKoubunshoPdfFileName('arbitrary.pdf')).toBe(false);
    expect(isShahoKoubunshoPdfFileName('2501793096_xxx.pdf')).toBe(false);
  });
});

describe('getNoticeTitleFromPdfFileName — 通知書名取得', () => {
  it.each([
    ['7100001.pdf', '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書'],
    ['7120002.pdf', '健康保険・厚生年金保険資格喪失確認通知書'],
    ['7130001.pdf', '健康保険・厚生年金保険被保険者標準報酬決定通知書'],
    ['7140001.pdf', '健康保険・厚生年金保険被保険者標準報酬改定通知書'],
    ['7150001.pdf', '健康保険・厚生年金保険被保険者賞与額決定通知書'],
    ['7170003.pdf', '健康保険被扶養者（異動）決定通知書'],
  ] as const)('%s → %s', (fileName, expectedTitle) => {
    expect(getNoticeTitleFromPdfFileName(fileName)).toBe(expectedTitle);
  });

  it('未知IDは null', () => {
    expect(getNoticeTitleFromPdfFileName('7999999.pdf')).toBe(null);
  });

  it('PDFでないファイル名は null', () => {
    expect(getNoticeTitleFromPdfFileName('7150001.xml')).toBe(null);
  });
});

describe('extractInsurerNameFromItems — テキストアイテムから被保険者名抽出', () => {
  it('「被保険者氏名」ヘッダ直下のテキストを連結して返す（7150001 想定）', () => {
    const items = [
      // ヘッダ群
      { str: '健康保険・厚生年金保険標準賞与額決定通知書', x: 173.3, y: 569.4 },
      { str: '被保険者氏名', x: 156.6, y: 506.1 },
      { str: '賞与支払年月日', x: 251.6, y: 506.1 },
      { str: '生年月日', x: 439.2, y: 505.5 },
      // データ行
      { str: '1', x: 103.9, y: 477.0 }, // 整理番号（範囲外）
      { str: '大谷', x: 115.6, y: 477.0 },
      { str: '駿斗', x: 145.3, y: 477.0 },
      { str: 'R', x: 256.5, y: 476.8 }, // 隣接列（範囲外）
      { str: '7 12 25', x: 268.6, y: 476.8 },
    ];

    // PDF上で `大谷 駿斗` のように姓と名の間に視覚的な空白がある場合
    // (大谷のx=115.6 → 駿斗のx=145.3, gap≈14pt は半角空白相当)、
    // フォルダ名表記と揃えるため半角スペースで連結する。
    expect(extractInsurerNameFromItems(items)).toBe('大谷 駿斗');
  });

  it('「被保険者氏名」ヘッダ直下のテキストを連結して返す（7120002 想定）', () => {
    const items = [
      { str: '被保険者氏名', x: 155.7, y: 519.8 },
      { str: '資格喪失年月日', x: 251.3, y: 519.8 },
      { str: '31', x: 94.2, y: 496.8 }, // 整理番号（範囲外）
      { str: '陳', x: 162.9, y: 496.8 },
      { str: '修', x: 182.5, y: 496.8 },
      { str: 'R', x: 252.2, y: 496.8 }, // 隣接列（範囲外）
    ];

    // 陳 (x=162.9, 1文字) → 修 (x=182.5) は約 12pt のギャップ = 半角空白相当
    expect(extractInsurerNameFromItems(items)).toBe('陳 修');
  });

  it('「被保険者氏名」ヘッダが無いページは null（付記/補足ページ）', () => {
    const items = [
      { str: '健康保険・厚生年金保険標準賞与額決定通知書', x: 176.9, y: 590.6 },
      { str: '付記', x: 146.9, y: 463.0 },
      { str: 'この通知書の決定に不服があるときは、', x: 95.5, y: 433.8 },
    ];

    expect(extractInsurerNameFromItems(items)).toBe(null);
  });

  it('ヘッダはあるがデータ行が空のページは null', () => {
    const items = [
      { str: '被保険者氏名', x: 156.6, y: 506.1 },
      { str: '賞与支払年月日', x: 251.6, y: 506.1 },
      // データ行なし
    ];

    expect(extractInsurerNameFromItems(items)).toBe(null);
  });

  it('カタカナ氏名にも対応', () => {
    const items = [
      { str: '被保険者氏名', x: 156.6, y: 506.1 },
      { str: '富永', x: 115.6, y: 477.0 },
      { str: 'リイ子', x: 145.3, y: 477.0 },
    ];

    // 富永 (x=115.6, 2文字) → リイ子 (x=145.3) は約 14pt のギャップ = 半角空白相当
    expect(extractInsurerNameFromItems(items)).toBe('富永 リイ子');
  });

  it('整理番号列（x < headerX - 50）は除外', () => {
    const items = [
      { str: '被保険者氏名', x: 200.0, y: 500.0 },
      { str: '99', x: 100.0, y: 480.0 }, // x=100 < 150 → 除外
      { str: '田中', x: 175.0, y: 480.0 }, // x=175 ≥ 150 → 採用
    ];

    expect(extractInsurerNameFromItems(items)).toBe('田中');
  });

  it('二段ヘッダ（7100001 想定）: サブヘッダ行を飛ばして本文フォントのデータ行を採用', () => {
    // ヘッダ y=526, データ行 y=463（63pt 下）、間にサブヘッダ行 y=507/498/505/492
    // サブヘッダはヘッダと同じ ~7.9pt、データ行は ~9.9pt
    const items = [
      { str: '被保険者氏名', x: 159.3, y: 526.4, h: 7.9 },
      // サブヘッダ行（同じフォント高さ → データ行扱いされない）
      { str: '生年月日', x: 110.3, y: 498.1, h: 7.9 },
      { str: '※2', x: 149.6, y: 507.0, h: 7.9 },
      { str: '種別(性別)', x: 152.8, y: 498.1, h: 7.9 },
      { str: '※3', x: 195.7, y: 507.0, h: 7.9 },
      { str: '取得区分', x: 197.3, y: 498.1, h: 7.9 },
      { str: '被保険者', x: 231.7, y: 505.2, h: 8.0 },
      { str: '区分', x: 231.7, y: 492.2, h: 8.0 },
      // カナ氏名行（フォント小 → サブヘッダ扱い、データ行が見つかれば不採用）
      { str: 'ﾋｶﾞｼ ｽｽﾞｶ', x: 129.1, y: 476.7, h: 7.9 },
      // 本文サイズのデータ行（漢字氏名）
      { str: '東', x: 120.6, y: 463.1, h: 9.9 },
      { str: '鈴加', x: 140.4, y: 463.1, h: 9.9 },
    ];

    // 東 (x=120.6) → 鈴加 (x=140.4) は約 10pt のギャップ ≒ 1 文字幅 = 半角空白
    expect(extractInsurerNameFromItems(items)).toBe('東 鈴加');
  });

  it('二段ヘッダで本文サイズが見つからない場合は null（誤抽出回避）', () => {
    // ヘッダ + サブヘッダのみで実データが無いページ（誤検出フォールバック）
    const items = [
      { str: '被保険者氏名', x: 159.3, y: 526.4, h: 7.9 },
      { str: '生年月日', x: 110.3, y: 498.1, h: 7.9 },
      { str: '※2', x: 149.6, y: 507.0, h: 7.9 },
      { str: '種別(性別)', x: 152.8, y: 498.1, h: 7.9 },
    ];

    // サブヘッダ文字列は KNOWN_LABELS or ※ で弾かれて null
    expect(extractInsurerNameFromItems(items)).toBe(null);
  });
});

describe('splitShahoKoubunshoPdf — 統合テスト（実PDF）', () => {
  const fixturesDir = path.join(
    __dirname,
    'integration',
    'fixtures',
    'koubunsho'
  );

  it('7150001_multi.pdf（4名・5ページ）→ 4個の分割PDF＋付記ページを各PDFに同梱', async () => {
    const pdfBuffer = await fs.readFile(
      path.join(fixturesDir, '7150001_multi.pdf')
    );

    const results = await splitShahoKoubunshoPdf(pdfBuffer, '7150001.pdf');

    expect(results.length).toBe(4);

    // PDF 上の姓-名の間にある視覚的空白は半角スペースとして保持する
    const names = results.map((r) => r.name);
    expect(names).toContain(
      '大谷 駿斗様_健康保険・厚生年金保険被保険者賞与額決定通知書.pdf'
    );
    expect(names).toContain(
      '三木 瞭平様_健康保険・厚生年金保険被保険者賞与額決定通知書.pdf'
    );
    expect(names).toContain(
      '田中 廉人様_健康保険・厚生年金保険被保険者賞与額決定通知書.pdf'
    );
    expect(names).toContain(
      '富永 リイ子様_健康保険・厚生年金保険被保険者賞与額決定通知書.pdf'
    );

    // 各分割PDFは [通知ページ + 付記ページ] = 2ページ
    for (const r of results) {
      const doc = await PDFDocument.load(r.buffer);
      expect(doc.getPageCount()).toBe(2);
    }
  }, 30000);

  it('7150001_single.pdf（1名・2ページ）→ 1個の分割PDF', async () => {
    const pdfBuffer = await fs.readFile(
      path.join(fixturesDir, '7150001_single.pdf')
    );

    const results = await splitShahoKoubunshoPdf(pdfBuffer, '7150001.pdf');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe(
      '原 岬平様_健康保険・厚生年金保険被保険者賞与額決定通知書.pdf'
    );

    const doc = await PDFDocument.load(results[0].buffer);
    expect(doc.getPageCount()).toBe(2);
  }, 30000);

  it('7100001_single.pdf（1名・二段ヘッダレイアウト）→ 漢字氏名で分割', async () => {
    // 二段ヘッダ（※1 生年月日 / ※2 種別(性別) / ※3 取得区分 / 被保険者区分 が
    // 「被保険者氏名」直下にサブヘッダとして並び、その下に実データ行）
    // のレイアウトで、サブヘッダ文字列を氏名として誤抽出していたバグの回帰防止。
    const pdfBuffer = await fs.readFile(
      path.join(fixturesDir, '7100001_single.pdf')
    );

    const results = await splitShahoKoubunshoPdf(pdfBuffer, '7100001.pdf');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe(
      '東 鈴加様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf'
    );

    // 89文字制限内（folder + filename 合計のうち filename 側）
    expect(results[0].name.length).toBeLessThan(50);

    // サブヘッダ文字列が紛れ込んでいないこと（過去のバグの回帰防止）
    expect(results[0].name).not.toContain('※');
    expect(results[0].name).not.toContain('生年月日');
    expect(results[0].name).not.toContain('種別');
    expect(results[0].name).not.toContain('取得区分');
  }, 30000);

  it('7120002_single.pdf（1名・2ページ）→ 1個の分割PDF', async () => {
    const pdfBuffer = await fs.readFile(
      path.join(fixturesDir, '7120002_single.pdf')
    );

    const results = await splitShahoKoubunshoPdf(pdfBuffer, '7120002.pdf');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe(
      '陳 修様_健康保険・厚生年金保険資格喪失確認通知書.pdf'
    );

    const doc = await PDFDocument.load(results[0].buffer);
    expect(doc.getPageCount()).toBe(2);
  }, 30000);

  it('未対応のファイル名 → 空配列', async () => {
    const pdfBuffer = await fs.readFile(
      path.join(fixturesDir, '7150001_multi.pdf')
    );

    const results = await splitShahoKoubunshoPdf(pdfBuffer, 'unknown.pdf');

    expect(results).toEqual([]);
  });
});
