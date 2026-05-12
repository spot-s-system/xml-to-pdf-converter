/**
 * バルクZIP処理パイプラインの統合テスト
 *
 * 対象: ZIP展開 → フォルダ構造解析 → XML/XSLペア検出 → PDF生成 → リネーム → 結果ZIP組立
 *
 * fixture は __tests__/integration/fixtures/ にローカル配置する想定。
 * 顧客個人情報を含むため git には追加されない（fixtures/.gitignore で除外）。
 * fixture が無いテストは自動 skip。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  extractZipFile,
  analyzeFolderStructure,
  processFoldersToZip,
  cleanupTempDirectory,
} from '@/lib/bulk-zip-processor';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

async function fixtureExists(name: string): Promise<boolean> {
  try {
    await fs.access(path.join(FIXTURES_DIR, name));
    return true;
  } catch {
    return false;
  }
}

async function loadFixture(name: string): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES_DIR, name));
}

/**
 * 単発テストヘルパー: fixture を解凍してパイプラインに通し、結果ZIPのエントリ名一覧を返す。
 */
async function runPipeline(fixtureName: string): Promise<{
  entries: string[];
  pdfs: string[];
}> {
  const zipBuffer = await loadFixture(fixtureName);
  const extractPath = await extractZipFile(zipBuffer);
  try {
    const folders = await analyzeFolderStructure(extractPath);
    const resultZip = await processFoldersToZip(folders, extractPath);
    const entries = Object.keys(resultZip.files);
    const pdfs = entries.filter((e) => e.toLowerCase().endsWith('.pdf'));
    return { entries, pdfs };
  } finally {
    await cleanupTempDirectory(extractPath);
  }
}

describe('integration: 月額変更_70歳以上含む.zip', async () => {
  const fixtureName = '月額変更_70歳以上含む.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '7140001 (月額変更) と 7210001 (70歳以上月額変更) が複数名統合PDFとして生成される',
    async () => {
      const { pdfs, entries } = await runPipeline(fixtureName);

      // 表紙 + 7140001 + 7210001 → 3つの生成PDF
      // (kagami は到達番号XML 202510171622459734.xml から生成)
      expect(pdfs.length).toBeGreaterThanOrEqual(3);

      // 7140001: 山下 尚利様他1名_…改定通知書
      expect(pdfs.some((p) =>
        /^令和7年11月改定_.+様他1名_健康保険・厚生年金保険被保険者標準報酬改定通知書\.pdf$/.test(p)
      )).toBe(true);

      // 7210001: 70歳以上版（convertEraCode のフルテキスト元号サポートで
      // 7140001 と同じ "令和n年m月改定_…" 形式に統一されている）
      expect(pdfs.some((p) =>
        /^令和7年11月改定_.+様他1名_厚生年金保険70歳以上被用者標準報酬月額相当額改定のお知らせ\.pdf$/.test(p)
      )).toBe(true);

      // 元のXML/XSLも結果ZIPに残ること（公文書アーカイブの維持）
      expect(entries.some((e) => e.endsWith('7140001.xml'))).toBe(true);
      expect(entries.some((e) => e.endsWith('7140001.xsl'))).toBe(true);
      expect(entries.some((e) => e.endsWith('7210001.xml'))).toBe(true);
      expect(entries.some((e) => e.endsWith('7210001.xsl'))).toBe(true);
    },
    180_000 // Puppeteer 起動 + 複数PDF生成のため長めのタイムアウト
  );
});

describe('integration: 資格取得_70歳以上.zip', async () => {
  const fixtureName = '資格取得_70歳以上.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '[社保]資格取得フォルダから 7100001/7180001 の個別PDFが生成される',
    async () => {
      const { pdfs } = await runPipeline(fixtureName);

      // 各フォルダで kagami + 7100001 (個人毎) + 7180001 (個人毎) 等のPDFが生成される
      expect(pdfs.length).toBeGreaterThan(0);

      // 7100001 由来の出力
      expect(pdfs.some((p) =>
        /様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書\.pdf$/.test(p)
      )).toBe(true);

      // 7180001 由来の出力（70歳以上 該当）
      expect(pdfs.some((p) =>
        /様_厚生年金保険70歳以上被用者該当および標準報酬月額相当額のお知らせ\.pdf$/.test(p)
      )).toBe(true);
    },
    300_000
  );

  it.skipIf(!has)(
    'ルートのExcelファイル（公文書・コメント一括出力リスト.xlsx）が結果ZIPに保持される',
    async () => {
      const { entries } = await runPipeline(fixtureName);
      expect(entries.some((e) => e.endsWith('.xlsx'))).toBe(true);
    },
    300_000
  );
});

describe('integration: 育児_社保雇保混在.zip', async () => {
  const fixtureName = '育児_社保雇保混在.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '[社保]育休フォルダで XML → {名前}様_育児休業等取得者確認通知書.pdf が生成される',
    async () => {
      const { pdfs } = await runPipeline(fixtureName);
      expect(pdfs.some((p) =>
        /様_健康保険・厚生年金保険育児休業等取得者確認通知書\.pdf$/.test(p)
      )).toBe(true);
    },
    600_000
  );

  it.skipIf(!has)(
    '[雇保]育児時短就業給付の同梱PDFが {名前}様_… にリネームされる',
    async () => {
      const { pdfs } = await runPipeline(fixtureName);
      // ハイフン区切りの数字プレフィックス (`202602021152166333-0001_…`) が
      // {名前}様_ に置換されている
      expect(pdfs.some((p) =>
        /様_育児時短就業給付金支給.+通知書.*\.pdf$/.test(p)
      )).toBe(true);

      // 数字プレフィックスのままのPDFは残っていないこと（リネーム漏れ検出）
      expect(pdfs.some((p) =>
        /^[\w\W]*\/?\d{18}-\d{4}_/.test(p)
      )).toBe(false);
    },
    600_000
  );

  it.skipIf(!has)(
    '[雇保]育児時短就業給付フォルダ同梱の「育児に関する新たな給付等についてのお知らせ.pdf」' +
      'のような非数字プレフィックスPDFはリネーム対象外でそのまま残置される',
    async () => {
      const { entries } = await runPipeline(fixtureName);
      expect(entries.some((e) =>
        /\/育児に関する新たな給付等についてのお知らせ\.pdf$/.test(e)
      )).toBe(true);
    },
    600_000
  );
});
