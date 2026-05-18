/**
 * 公文書PDF（社保通知書）分割ロジックの統合テスト
 *
 * 対象: lib/koubunsho-pdf-splitter.ts の splitShahoKoubunshoPdf
 *
 * fixture は __tests__/integration/fixtures/koubunsho/ にローカル配置する想定。
 * 顧客個人情報を含むため git には追加されない（fixtures/.gitignore で除外）。
 * fixture が無いテストは自動 skip。
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { splitShahoKoubunshoPdf } from '@/lib/koubunsho-pdf-splitter';

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'koubunsho');

async function fixtureExists(name: string): Promise<boolean> {
  try {
    await fs.access(path.join(FIXTURES_DIR, name));
    return true;
  } catch {
    return false;
  }
}

describe('integration: 7150001_multi.pdf (複数名分の賞与決定通知書)', async () => {
  const fixtureName = '7150001_multi.pdf';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '4名・5ページ → 4個の分割PDF＋付記ページを各PDFに同梱',
    async () => {
      const pdfBuffer = await fs.readFile(path.join(FIXTURES_DIR, fixtureName));

      const results = await splitShahoKoubunshoPdf(pdfBuffer, '7150001.pdf');

      expect(results.length).toBe(4);

      // PDF 上の姓-名の間にある視覚的空白は半角スペースとして保持する
      // （フォルダ名表記 `大谷 駿斗` 等と一致させる）
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
    },
    30000
  );

  it.skipIf(!has)('未対応のファイル名 → 空配列', async () => {
    const pdfBuffer = await fs.readFile(path.join(FIXTURES_DIR, fixtureName));

    const results = await splitShahoKoubunshoPdf(pdfBuffer, 'unknown.pdf');

    expect(results).toEqual([]);
  });
});

describe('integration: 7150001_single.pdf (単独名の賞与決定通知書)', async () => {
  const fixtureName = '7150001_single.pdf';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)('1名・2ページ → 1個の分割PDF', async () => {
    const pdfBuffer = await fs.readFile(path.join(FIXTURES_DIR, fixtureName));

    const results = await splitShahoKoubunshoPdf(pdfBuffer, '7150001.pdf');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe(
      '原 岬平様_健康保険・厚生年金保険被保険者賞与額決定通知書.pdf'
    );

    const doc = await PDFDocument.load(results[0].buffer);
    expect(doc.getPageCount()).toBe(2);
  }, 30000);
});

describe('integration: 7120002_single.pdf (資格喪失確認通知書)', async () => {
  const fixtureName = '7120002_single.pdf';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)('1名・2ページ → 1個の分割PDF', async () => {
    const pdfBuffer = await fs.readFile(path.join(FIXTURES_DIR, fixtureName));

    const results = await splitShahoKoubunshoPdf(pdfBuffer, '7120002.pdf');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe(
      '陳 修様_健康保険・厚生年金保険資格喪失確認通知書.pdf'
    );

    const doc = await PDFDocument.load(results[0].buffer);
    expect(doc.getPageCount()).toBe(2);
  }, 30000);
});

describe('integration: 7100001_single.pdf (二段ヘッダレイアウト)', async () => {
  // 二段ヘッダ（※1 生年月日 / ※2 種別(性別) / ※3 取得区分 / 被保険者区分 が
  // 「被保険者氏名」直下にサブヘッダとして並び、その下に実データ行）の
  // 7100001 PDF で、サブヘッダ文字列 (`生年月日※2種別(性別)※3取得区分被保険者区分`)
  // を氏名として誤抽出し、結果 ZIP のエントリ名が 89 文字を大幅に超えていた
  // バグの回帰防止。
  const fixtureName = '7100001_single.pdf';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)('1名・二段ヘッダレイアウト → 漢字氏名で分割', async () => {
    const pdfBuffer = await fs.readFile(path.join(FIXTURES_DIR, fixtureName));

    const results = await splitShahoKoubunshoPdf(pdfBuffer, '7100001.pdf');

    expect(results.length).toBe(1);
    expect(results[0].name).toBe(
      '東 鈴加様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf'
    );

    // サブヘッダ文字列が紛れ込んでいないこと（過去のバグの回帰防止）
    expect(results[0].name).not.toContain('※');
    expect(results[0].name).not.toContain('生年月日');
    expect(results[0].name).not.toContain('種別');
    expect(results[0].name).not.toContain('取得区分');
  }, 30000);
});
