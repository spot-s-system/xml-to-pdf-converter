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
import JSZip from 'jszip';
import {
  extractZipFile,
  analyzeFolderStructure,
  processFoldersToZip,
  cleanupTempDirectory,
} from '@/lib/bulk-zip-processor';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUTPUT_DIR = path.join(__dirname, 'output');

/**
 * JSZip ストリームから PDF を一度だけ読み出し、{ name → buffer } のマップを返す。
 * JSZip の ReadStream エントリは複数回 .async() を呼ぶと2回目以降空になるため、
 * バッファ化して以降の検証（ページ数算出・ディスク書き出し）はメモリ上で行う。
 */
async function materializePdfBuffers(
  resultZip: JSZip
): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  const tasks: Promise<void>[] = [];
  resultZip.forEach((relativePath, file) => {
    if (file.dir) return;
    if (!relativePath.toLowerCase().endsWith('.pdf')) return;
    tasks.push(
      (async () => {
        const buf = await file.async('nodebuffer');
        result.set(relativePath, buf);
      })()
    );
  });
  await Promise.all(tasks);
  return result;
}

/**
 * バッファ化済みPDFを __tests__/integration/output/{label}/ に書き出す。
 * output は .gitignore で git 管理外。実行前にディレクトリを毎回クリアする。
 */
async function dumpPdfBuffers(
  label: string,
  pdfBuffers: Map<string, Buffer>
): Promise<string> {
  const dir = path.join(OUTPUT_DIR, label);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(
    [...pdfBuffers].map(([relativePath, buf]) => {
      const safe = relativePath.replace(/[\\/]/g, '__');
      return fs.writeFile(path.join(dir, safe), buf);
    })
  );
  return dir;
}

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
async function runPipeline(
  fixtureName: string,
  options: { dumpLabel?: string } = {}
): Promise<{
  entries: string[];
  pdfs: string[];
  pdfPageCounts: number[];
  outputDir?: string;
}> {
  const zipBuffer = await loadFixture(fixtureName);
  const extractPath = await extractZipFile(zipBuffer);
  try {
    const folders = await analyzeFolderStructure(extractPath);
    const resultZip = await processFoldersToZip(folders, extractPath);
    const entries = Object.keys(resultZip.files);
    const pdfs = entries.filter((e) => e.toLowerCase().endsWith('.pdf'));

    // JSZip の ReadStream は使い捨てなので、PDF を1回だけ読み出してバッファ化し
    // 以降の検証はメモリ上で行う。
    const pdfBuffers = await materializePdfBuffers(resultZip);

    // PDFの各ページ数を集計（レイアウト不具合検出用: 余分な空白ページが
    // 入っているとここで気付ける）
    // PDFバイナリ内の "/Type /Page" カウントで簡易ページ数取得
    const pdfPageCounts = pdfs.map((name) => {
      const buf = pdfBuffers.get(name);
      if (!buf) return 0;
      const matches = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
      return matches?.length ?? 0;
    });

    let outputDir: string | undefined;
    if (options.dumpLabel) {
      outputDir = await dumpPdfBuffers(options.dumpLabel, pdfBuffers);
    }

    // パイプライン内で握りつぶされた変換エラーがあれば顕在化する
    const errorEntries = entries.filter((e) => e.endsWith('変換エラー.txt'));
    if (errorEntries.length > 0) {
      const sample = errorEntries[0];
      const file = resultZip.files[sample];
      const errorText = await file.async('text');
      // eslint-disable-next-line no-console
      console.error(`[pipeline error] ${sample}:\n${errorText}`);
    }

    return { entries, pdfs, pdfPageCounts, outputDir };
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
    '[社保]資格取得フォルダから 7100001/7180001 の個別PDFが生成され、各PDFは2ページ構成 (Edge等価)',
    async () => {
      const { pdfs, pdfPageCounts, outputDir } = await runPipeline(fixtureName, {
        dumpLabel: '資格取得_70歳以上',
      });

      expect(pdfs.length).toBeGreaterThan(0);

      // 7100001 由来の出力
      const p7100001 = pdfs.findIndex((p) =>
        /様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書\.pdf$/.test(p)
      );
      expect(p7100001).toBeGreaterThanOrEqual(0);

      // 7180001 由来の出力（70歳以上 該当）
      const p7180001 = pdfs.findIndex((p) =>
        /様_厚生年金保険70歳以上被用者該当および標準報酬月額相当額のお知らせ\.pdf$/.test(p)
      );
      expect(p7180001).toBeGreaterThanOrEqual(0);

      // レイアウト不具合検出:
      //  - 7100001 (資格取得確認通知書): XSL に kyoji (不服注意書き) template があり
      //    通知書本体 + 教示文 = 2ページが期待値。
      //    過去に xsl-adjuster の過剰なスタイル上書きで通知書本体1ページ目が
      //    あふれ、3ページになる不具合があった。
      //  - 7180001 (70歳以上 該当のお知らせ): XSL に kyoji template がなく
      //    通知書本体のみ。1ページが期待値。
      expect(pdfPageCounts[p7100001]).toBe(2);
      expect(pdfPageCounts[p7180001]).toBe(1);

      // 出力先を test runner ログに出して、目視確認しやすくする
      // eslint-disable-next-line no-console
      console.log(`[dump] PDFs written to: ${outputDir}`);
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
