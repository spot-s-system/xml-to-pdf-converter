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
      // 注: 通知書名の末尾は 89文字制限のため切り詰められる可能性があるので、
      // 識別可能なプレフィックスでマッチさせる（被保険者名はフル長で保持される方針）
      const p7100001 = pdfs.findIndex((p) =>
        /様_健康保険・厚生年金保険資格取得確認/.test(p) && p.endsWith('.pdf')
      );
      expect(p7100001).toBeGreaterThanOrEqual(0);

      // 7180001 由来の出力（70歳以上 該当）
      const p7180001 = pdfs.findIndex((p) =>
        /様_厚生年金保険70歳以上被用者該当/.test(p) && p.endsWith('.pdf')
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

describe('integration: 月変_外国籍含む.zip (漢字氏名空→カナ氏名フォールバック)', async () => {
  const fixtureName = '月変_外国籍含む.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '漢字氏名が CDATA 空の外国籍被保険者でも、カナ氏名でリネームされる',
    async () => {
      const { pdfs, outputDir } = await runPipeline(fixtureName, {
        dumpLabel: '月変_外国籍含む',
      });

      // 「様_…」(被保険者名抜け) のPDFが残っていないこと
      expect(pdfs.some((p) => /\/様_/.test(p) || /^様_/.test(p))).toBe(false);

      // 半角カナ「ｱﾙﾇ ﾌﾛｰﾚﾝｽ ｼﾞﾖｾﾞﾌｲﾝ ﾃﾚｽﾞ」のいずれかが含まれるPDF名で
      // 出力されること (XML の <被保険者カナ氏名> フォールバック)
      expect(pdfs.some((p) => /ｱﾙﾇ.*ﾌﾛｰﾚﾝｽ.*様_/.test(p))).toBe(true);

      // eslint-disable-next-line no-console
      console.log(`[dump] PDFs written to: ${outputDir}`);
    },
    600_000
  );
});

describe('integration: 長文字数_取得月変.zip (89文字超過→被保険者名トリミング)', async () => {
  const fixtureName = '長文字数_取得月変.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '長い会社名フォルダ + 外国籍カナ氏名でも、結果ZIPの全エントリパスが89文字以下に収まる',
    async () => {
      const { entries, pdfs, outputDir } = await runPipeline(fixtureName, {
        dumpLabel: '長文字数_取得月変',
      });

      // Windowsエクスプローラ (Shell.Application) は 90 文字以上のエントリを
      // 認識できず、結果ZIPを開いても「エントリ 0 件」になってしまう。
      // 生成側で 89 文字以下に収まるよう被保険者名側を切り詰めている。
      const overLimit = entries.filter((e) => e.length > 89);
      expect(
        overLimit,
        `89文字超のエントリが残っている:\n${overLimit.map((e) => `  ${e.length}: ${e}`).join('\n')}`
      ).toEqual([]);

      // PDFが1件以上生成されている（パイプラインが空振りで終わっていないことの確認）
      expect(pdfs.length).toBeGreaterThan(0);

      const pdfBasenames = pdfs.map((p) => p.split('/').pop() ?? '');

      // 被保険者名が完全に消えた「様_…」始まりのPDFが残っていないこと
      // (トリミング時に最低 1 文字は被保険者名を残す保証の回帰検出)
      expect(pdfBasenames.some((n) => n.startsWith('様_'))).toBe(false);

      // 「{名前}様[他N名]_{通知書名}.pdf」形式のPDFについて、
      // - `<name>様[他N名]_` のタグ構造は崩れず、
      // - その直前の被保険者名（途中で切れていてもOK）と
      //   その直後に通知書名と `.pdf` が続くこと。
      // 新方針: 通知書名（帳票名）はフル保持し、文字数超過時は **被保険者名側**を
      // 切り詰める。極端ケース（被保険者名 1 文字でも超過）のみ通知書名末尾も削る。
      // `表紙.pdf` / `通知書.pdf` などの kagami/フォールバック名は対象外。
      // 対象は被保険者リネーム後のファイル（`様[他N名]_` タグを持つもの）のみ。
      // `事業主の皆様へ（…）.pdf` のような同梱の案内 PDF は氏名と無関係に「様」を
      // 含むため除外する。
      const samaPdfs = pdfBasenames.filter((n) => /様(?:他\d+名)?_/.test(n));
      expect(samaPdfs.length).toBeGreaterThan(0);
      const malformed = samaPdfs.filter((n) => !/様(他\d+名)?_.+\.pdf$/.test(n));
      expect(
        malformed,
        `様 を含むPDFで suffix が崩れているもの:\n${malformed.join('\n')}`
      ).toEqual([]);

      // eslint-disable-next-line no-console
      console.log(`[dump] PDFs written to: ${outputDir}`);
    },
    600_000
  );
});

describe('integration: 扶養.zip', async () => {
  const fixtureName = '扶養.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '[社保]被扶養者異動 (7170003) の個別PDFが生成され、1ページ構成 (kyoji 同枠)',
    async () => {
      const { pdfs, pdfPageCounts, outputDir } = await runPipeline(fixtureName, {
        dumpLabel: '扶養',
      });

      // 7170003 由来の出力
      const p7170003 = pdfs.findIndex((p) =>
        /様_健康保険被扶養者（異動）決定通知書\.pdf$/.test(p)
      );
      expect(p7170003).toBeGreaterThanOrEqual(0);

      // 7170003 (扶養) は kyoji が outline 内に同居する設計のため 1 ページ。
      // 過去に pre.kyouji の白スペース指定が Webkit 限定で Chromium にヒット
      // せず、教示文テキストが横にあふれて外枠を突き抜ける不具合があった。
      // この回帰を検出するため、ページ数を厳密に 1 で検証する。
      expect(pdfPageCounts[p7170003]).toBe(1);

      // eslint-disable-next-line no-console
      console.log(`[dump] PDFs written to: ${outputDir}`);
    },
    300_000
  );
});

describe('integration: 育児_社保雇保混在.zip', async () => {
  const fixtureName = '育児_社保雇保混在.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '[雇保]育児休業出生後休業給付の同梱PDFが {名前}様_… にリネームされる',
    async () => {
      const { pdfs } = await runPipeline(fixtureName, {
        dumpLabel: '育児_社保雇保混在',
      });

      // ハイフン区切りの数字プレフィックス (`202605111132323353-0001_…`) が
      // {名前}様_ に置換されている (3 種類の通知書が同梱されているはず)
      expect(pdfs.some((p) =>
        /様_育児休業給付金・出生後休業支援給付金支給申請書\.pdf$/.test(p)
      )).toBe(true);
      expect(pdfs.some((p) =>
        /様_育児休業給付金支給／不支給決定通知書\(被保険者通知用\)\.pdf$/.test(p)
      )).toBe(true);
      expect(pdfs.some((p) =>
        /様_育児休業給付次回支給申請日指定通知書\(事業主通知用\)\.pdf$/.test(p)
      )).toBe(true);

      // 数字プレフィックスのままのPDFは残っていないこと（リネーム漏れ検出）
      expect(pdfs.some((p) => /\d{18}-\d{4}_/.test(p))).toBe(false);
    },
    600_000
  );

  it.skipIf(!has)(
    '[雇保]フォルダ同梱の「育児に関する新たな給付等についてのお知らせ.pdf」など' +
      '非数字プレフィックスのPDFはリネーム対象外でそのまま残置される',
    async () => {
      const { entries } = await runPipeline(fixtureName);
      // 案内系の同梱PDFは元名のまま残る
      expect(entries.some((e) =>
        /\/育児に関する新たな給付等についてのお知らせ\.pdf$/.test(e)
      )).toBe(true);
      expect(entries.some((e) =>
        /\/LL070401離職日までの育児休業給付金\.pdf$/.test(e)
      )).toBe(true);
    },
    600_000
  );

  it.skipIf(!has)(
    '[社保]育児休業等終了届フォルダの 7020001.pdf は 育児休業等取得者終了確認通知書 タイトルで {名前}様_ にリネームされる',
    async () => {
      // このフィクスチャのフォルダ名は `..._[社保]育児休業等終了届_{到達番号}` で、
      // `_公文書_` を含まない。そのため SHAHO_PER_PERSON_RENAME_MAP
      // （`_公文書_` ゲート付き・育休と終了届を同一タイトルに丸める誤マッチ許容マップ）
      // は発火せず、processOtherFile が SHAHO_NOTICE_TITLES['7020001'] =
      // 「健康保険・厚生年金保険育児休業等取得者終了確認通知書」を直接使う。
      // 終了届に対しては「終了確認通知書」が正しいタイトルなので、これが期待値。
      const { entries } = await runPipeline(fixtureName);
      expect(entries.some((e) =>
        /\[社保\]育児休業等終了届.*様_健康保険・厚生年金保険育児休業等取得者終了確認通知書\.pdf$/.test(e)
      )).toBe(true);
    },
    600_000
  );
});

describe('integration: 展開エラー_氏名トリミング回帰.zip', async () => {
  // ユーザー実データ由来のリグレッションフィクスチャ。複合バグを 1 ZIP で再現:
  //   1. [社保]資格取得 7100001.pdf の二段ヘッダ（※1/※2/※3 サブヘッダ）から
  //      氏名を誤抽出して `生年月日※2種別(性別)※3取得区分被保険者区分様_…` を
  //      生成、結果 ZIP のエントリパスが 89 文字制限を超過し Windows Shell で
  //      「すべて展開」が 0 件扱いとなり展開不能だった
  //   2. (旧仕様) 通知書名末尾を削っていた結果 `(事業主用)`/`(被保険者用)` が
  //      失われ、同フォルダ 2 ファイルが見分けられなくなる苦情が発生
  //      → 新方針: **帳票名(通知書名)はフル保持**、被保険者名側を切り詰める。
  //   3. 会社名が極端に長く `_[雇保]xxx` の `]` まで `・・・` で切り詰められた
  //      フォルダ（0009 株式会社Ｙａｃｈｔ Ｌｉｆｅ Ｄｅｓｉｇｎ）で
  //      `202604…-0001_xxx.pdf` のリネーム漏れが発生
  // それぞれ koubunsho-pdf-splitter / bulk-zip-processor の修正で解消済み。
  const fixtureName = '展開エラー_氏名トリミング回帰.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '全エントリが 89 文字以下に収まり、帳票名がフル保持される',
    async () => {
      const { entries, pdfs, outputDir } = await runPipeline(fixtureName, {
        dumpLabel: '展開エラー_氏名トリミング回帰',
      });

      // (1) 展開可能性: 全エントリパスが Windows Shell 互換の 89 文字以下
      // 1 件でも超過すると `すべて展開` がエントリ 0 件扱いになる
      const overLimit = entries.filter((e) => e.length > 89);
      expect(
        overLimit,
        `89文字超のエントリが残っている:\n${overLimit
          .map((e) => `  ${e.length}: ${e}`)
          .join('\n')}`
      ).toEqual([]);

      // (2) 帳票名フル保持: 通知書名末尾の識別子 `(事業主用)` / `(被保険者用)` /
      // `(被保険者通知用)` 等が切り落とされないこと。新方針では文字数超過時に
      // 被保険者名側を削るため、これらの suffix は必ず末尾に残る。
      const titleSuffixesToPreserve = [
        /\(事業主用\)\.pdf$/,
        /\(被保険者用\)\.pdf$/,
      ];
      for (const suffix of titleSuffixesToPreserve) {
        expect(
          pdfs.some((p) => suffix.test(p.split('/').pop() ?? '')),
          `通知書名末尾 ${suffix} を保持する PDF が見つからない（帳票名が末尾で切り詰められている）`
        ).toBe(true);
      }

      // 被保険者名は budget 都合で末尾が切り詰められる可能性があるため、
      // ファイル名形式（`<name>様[他N名]_<title>.pdf`）の構造のみ検証する。
      // 完全に消えた「様_…」始まりは許さない（最低 1 文字は名前を残す保証）。
      // 対象は被保険者リネーム後のファイル（`様[他N名]_` タグを持つもの）のみ。
      // `事業主の皆様へ（…）.pdf` のような同梱の案内 PDF は氏名と無関係に「様」を
      // 含むため除外する（これらは passthrough で帳票名形式の検証対象外）。
      const pdfBasenames = pdfs.map((p) => p.split('/').pop() ?? '');
      const samaPdfs = pdfBasenames.filter((n) => /様(?:他\d+名)?_/.test(n));
      expect(samaPdfs.some((n) => n.startsWith('様_'))).toBe(false);
      const malformed = samaPdfs.filter((n) => !/様(他\d+名)?_.+\.pdf$/.test(n));
      expect(
        malformed,
        `様 を含むPDFで suffix が崩れているもの:\n${malformed.join('\n')}`
      ).toEqual([]);

      // (3) 二段ヘッダ誤抽出のリグレッション検出: ※やサブヘッダ用語が
      // 氏名として紛れ込んでいないこと
      const malformedNames = pdfs.filter((p) => {
        const base = p.split('/').pop() ?? '';
        const beforeSama = base.split('様')[0];
        return /[※]/.test(beforeSama) || /生年月日|種別|取得区分|被保険者区分/.test(beforeSama);
      });
      expect(
        malformedNames,
        `サブヘッダ用語が氏名として誤抽出された PDF:\n${malformedNames.join('\n')}`
      ).toEqual([]);

      // (4) 雇保 リネーム漏れ検出: 0009 フォルダ末尾が `_[雇・・・` で
      // 切り詰められていても、`{日付プレフィックス}-{連番}_xxx.pdf` 形式の
      // ファイルが `{大月 由佳子}様_xxx.pdf` にリネームされていること
      const unrenamedYakuho = pdfs.filter((p) => {
        const base = p.split('/').pop() ?? '';
        // `202604090933309263-0001_xxx.pdf` のような原形が残っているもの
        return /^\d{10,}-\d+_/.test(base);
      });
      expect(
        unrenamedYakuho,
        `雇保PDFがリネームされず原形のまま:\n${unrenamedYakuho.join('\n')}`
      ).toEqual([]);

      // eslint-disable-next-line no-console
      console.log(`[dump] PDFs written to: ${outputDir}`);
    },
    600_000
  );
});

describe('integration: 雇保資格取得_氏名帳票名フル保持.zip', async () => {
  // ユーザー実データ由来の回帰（朝倉 美穂様 / 株式会社ミツモア）。
  // バグ: 出力フォルダ名が末尾の到達番号(18桁) `202605010954058363・・・` を保持して
  // 89字制限を超過し、被保険者名(朝倉 美穂→朝)と帳票名((被保険者用)→(被保))の
  // 両方が切り詰められていた。
  // 修正: compressFolderNameForBudget が末尾到達番号を落として budget を確保し、
  // 氏名・帳票名ともフル保持する（stripTrailingReceptionNumber）。
  const fixtureName = '雇保資格取得_氏名帳票名フル保持.zip';
  const has = await fixtureExists(fixtureName);

  it.skipIf(!has)(
    '被保険者名・帳票名が切り詰められず、全エントリ89字以下',
    async () => {
      const { entries, pdfs, outputDir } = await runPipeline(fixtureName, {
        dumpLabel: '雇保資格取得_氏名帳票名フル保持',
      });

      // (1) 全エントリパスが89字以下
      const overLimit = entries.filter((e) => e.length > 89);
      expect(
        overLimit,
        `89文字超のエントリが残っている:\n${overLimit
          .map((e) => `  ${e.length}: ${e}`)
          .join('\n')}`
      ).toEqual([]);

      // (2) 雇保資格取得フォルダ（0003）の2つのPDFが氏名・帳票名フル保持
      const base = pdfs.map((p) => p.split('/').pop() ?? '');
      expect(
        base.some(
          (n) =>
            n ===
            '朝倉 美穂様_雇用保険被保険者証、資格取得等確認通知書(被保険者用).pdf'
        ),
        `(被保険者用) のフル名PDFが無い:\n${base.join('\n')}`
      ).toBe(true);
      expect(
        base.some(
          (n) =>
            n ===
            '朝倉 美穂様_雇用保険資格喪失届、資格取得等確認通知書(事業主用).pdf'
        ),
        `(事業主用) のフル名PDFが無い:\n${base.join('\n')}`
      ).toBe(true);

      // (3) 氏名が1文字に潰れた `朝様_…` のような切り詰めが残っていないこと
      const truncatedName = base.filter((n) => /^朝様_/.test(n));
      expect(
        truncatedName,
        `氏名が切り詰められたPDF:\n${truncatedName.join('\n')}`
      ).toEqual([]);

      // eslint-disable-next-line no-console
      console.log(`[dump] PDFs written to: ${outputDir}`);
    },
    600_000
  );
});
