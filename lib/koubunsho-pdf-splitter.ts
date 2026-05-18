/**
 * 公文書PDF（社保通知書）の被保険者ごと分割＋リネームロジック
 *
 * 対象: フォルダ内に同梱されている `7xxxxxx.pdf` 形式の社会保険通知書PDF。
 *   - 7100001: 健康保険・厚生年金保険資格取得確認および標準報酬決定通知書
 *   - 7120002: 健康保険・厚生年金保険資格喪失確認通知書
 *   - 7130001: 健康保険・厚生年金保険被保険者標準報酬決定通知書 (算定基礎)
 *   - 7140001: 健康保険・厚生年金保険被保険者標準報酬改定通知書 (月額変更)
 *   - 7150001: 健康保険・厚生年金保険被保険者賞与額決定通知書
 *   - 7170003: 健康保険被扶養者（異動）決定通知書
 *   - 7180001 / 7200001 / 7210001 / 7220001: 70歳以上被用者向け
 *
 * 動作:
 *   1) pdfjs-dist で各ページからテキストを抽出
 *   2) 「被保険者氏名」ヘッダ直下の行から被保険者名を読み取り、通知ページ／付記ページを分類
 *   3) pdf-lib で 通知ページ + 付記ページを組み合わせた個別 PDF を生成
 *   4) `{被保険者名}様_{通知書名}.pdf` にリネーム
 *
 * 通知ページが 0 件（被保険者氏名が抽出できなかった）→ 分割せず空配列を返す。
 * 呼び出し側はその場合は通常のリネーム経路にフォールバックすること。
 */

import path from 'path';
import { pathToFileURL } from 'url';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { SHAHO_NOTICE_TITLES } from './document-names';

/**
 * 公文書 PDF から抽出した氏名をファイル名に使うための軽量サニタイズ。
 *
 * `xml-parser` の `sanitizeFileName` は内部の半角/全角スペースまで削除するが、
 * 公文書 PDF の氏名表記は姓と名の間に視覚的空白を持つ（`東 鈴加`、`陳 修` 等）
 * のが慣例で、フォルダ名表記 (`_東 鈴加_`) とも揃える必要がある。
 * ここでは OS のファイル名禁止文字のみを除去し、空白は最大 1 個に collapse して
 * 保持する。
 */
function sanitizeInsurerNameForFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Next.js (Turbopack/webpack) でバンドルされた環境では、pdfjs-dist が
 * 自身の worker ファイル (`pdf.worker.mjs`) の場所を解決できず、
 * `Setting up fake worker failed: Cannot find module ...pdf.worker.mjs`
 * というエラーで PDF パースが失敗する。
 *
 * 対策: サーバーサイドで Node.js が直接読める絶対パス
 * (`node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`) を `file://` URL に
 * 変換して GlobalWorkerOptions.workerSrc に設定する。
 *
 * Windows では `c:\path\to\file` のような絶対パスを直接渡すと pdfjs-dist が
 * 「Only URLs with a scheme in: file, data, and node are supported」と
 * エラーになるため、必ず `pathToFileURL` で `file:///c:/...` に変換する。
 *
 * モジュールロード時の副作用ではなく初回呼び出し時に lazy 初期化することで、
 * テストや serverless cold start で `process.cwd()` が想定外のパスでも
 * splitShahoKoubunshoPdf を呼ばない限り影響しない。
 */
let pdfjsWorkerConfigured = false;
function ensurePdfjsWorkerConfigured(): void {
  if (pdfjsWorkerConfigured) return;
  const workerPath = path.resolve(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.worker.mjs'
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  pdfjsWorkerConfigured = true;
}

/**
 * 7xxxxxx.pdf 形式の社保公文書PDF判定
 *
 * `7012001.pdf` (新規適用; 会社単位) は被保険者氏名が無いため対象外。
 * 7012001 のフォールバックリネームは bulk-zip-processor の getFixedKoubunshoFilename
 * で別途扱う。
 */
/** `7012001` (新規適用; 会社単位) は被保険者氏名が無いため分割対象外。 */
const NON_SPLITTABLE_NOTICE_IDS = new Set(['7012001']);

function extractNoticeId(fileName: string): string | null {
  const m = fileName.match(/^(7\d{6})\.pdf$/i);
  return m ? m[1] : null;
}

export function isShahoKoubunshoPdfFileName(fileName: string): boolean {
  const id = extractNoticeId(fileName);
  if (!id) return false;
  return (
    !NON_SPLITTABLE_NOTICE_IDS.has(id) &&
    Object.hasOwn(SHAHO_NOTICE_TITLES, id)
  );
}

export function getNoticeTitleFromPdfFileName(fileName: string): string | null {
  const id = extractNoticeId(fileName);
  if (!id) return null;
  return SHAHO_NOTICE_TITLES[id] ?? null;
}

interface TextItemWithPos {
  str: string;
  x: number;
  y: number;
  /**
   * フォント高さ。pdfjs の transform[3] (y-scale) から得る。
   * テストから手書きアイテムを渡す場合は省略可（=データ行扱い）。
   */
  h?: number;
}

/**
 * pdfjs の TextContent から `(str, x, y, h)` の配列を抽出
 */
function toItemsWithPos(textItems: unknown[]): TextItemWithPos[] {
  const out: TextItemWithPos[] = [];
  for (const raw of textItems) {
    const item = raw as { str?: string; transform?: number[] };
    if (!item || typeof item.str !== 'string' || !item.transform) continue;
    if (!item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const h = Math.abs(item.transform[3]);
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    out.push({ str: item.str, x, y, h });
  }
  return out;
}

/**
 * 1ページ分のテキストアイテムから被保険者名を抽出する
 *
 * アルゴリズム:
 *   1. 「被保険者氏名」というラベルテキストを探す（ヘッダ位置 = headerX, headerY, headerH）
 *   2. ヘッダの 15〜70 pt 下 + headerX-50 〜 headerX+90 のx範囲にある
 *      テキストアイテムを取得（賞与=y-29、喪失=y-23、資格取得=y-63 のデータ行を
 *      まとめて捕捉。隣接列ヘッダの x ≒ headerX+95 と重ならないよう +90 で制限）
 *   3. **二段ヘッダ対策**: 7100001 (資格取得確認および標準報酬決定通知書) などは
 *      ヘッダ直下にサブヘッダ行（`※1 生年月日`、`※2 種別(性別)`、`被保険者区分` 等）
 *      が並び、その下に本来のデータ行が来る。サブヘッダはヘッダと同じ小さいフォント
 *      (h ≈ 7.9-8.0)、データ行は本文フォント (h ≈ 9-10) なので、ヘッダより明確に
 *      大きいフォントの項目だけをデータ行とみなす。
 *   4. データ行が見つからない場合は、サブヘッダの無いレイアウト（テストから手書きで
 *      渡されるケース含む）と判断し、範囲内アイテムをそのまま使う。
 *   5. x昇順にソートして連結 → 氏名
 *   6. 1文字も拾えなければ null（=このページは通知ページではない）
 *   7. 抽出結果が `※` を含むなど明らかなサブヘッダ／ラベル断片なら null
 *      （誤検出した場合の安全側フォールバック）。
 *
 * @internal — テスト用 export。本番コードはこの関数を直接使わない。
 */
export function extractInsurerNameFromItems(
  items: TextItemWithPos[]
): string | null {
  const headers = items.filter((it) => it.str === '被保険者氏名');
  if (headers.length === 0) return null;

  // 同じページに複数の「被保険者氏名」が並ぶ通知書フォーマットは観測されていないが、
  // 念のため最も上の（=最初の）ヘッダを使う
  const header = headers[0];
  const headerX = header.x;
  const headerY = header.y;
  const headerH = header.h ?? 7.9;

  // データ行の探索範囲。二段ヘッダ (7100001) のデータ行は最大 ~63pt 下に存在するため
  // 旧 -45 → -70 に拡張。
  const dataYmin = headerY - 70;
  const dataYmax = headerY - 15;
  const dataXmin = headerX - 50;
  const dataXmax = headerX + 90;

  const inColumn = items.filter(
    (it) =>
      it.y >= dataYmin &&
      it.y <= dataYmax &&
      it.x >= dataXmin &&
      it.x <= dataXmax
  );

  if (inColumn.length === 0) return null;

  // ヘッダフォント高さ + 1.0pt を超える項目 = 本文サイズの実データ
  // （サブヘッダはヘッダと同じ ~7.9-8.0pt、データ行は ~9-10pt）
  // h が無い（テストの手書きアイテム）は判定不可なので素通し
  const dataRowItems = inColumn.filter(
    (it) => it.h === undefined || it.h > headerH + 1.0
  );

  const picked = dataRowItems.length > 0 ? dataRowItems : inColumn;
  picked.sort((a, b) => a.x - b.x);

  // 隣接アイテム間に視覚的な空白（姓 と 名 の区切り等）がある場合は半角スペースで連結する。
  // フォルダ名は `東 鈴加` のように半角スペース区切りなので、ここで揃えて
  // 入力ZIPの表記と一致させる。
  // 判定: 直前アイテムの右端 + (フォント高さ * 0.5) より次のアイテムの x が右にある場合
  // を「明確な空白」とみなす。半角スペース相当のアイテム自体は str==' '+, 通常 picked
  // には含まれない（toItemsWithPos が trim 済みアイテムだけ拾うため）。
  const parts: string[] = [];
  for (let i = 0; i < picked.length; i++) {
    const it = picked[i];
    if (i > 0) {
      const prev = picked[i - 1];
      const prevRight =
        prev.x + Math.abs(prev.h ?? headerH) * Math.max(prev.str.length, 1);
      const charWidth = Math.abs(it.h ?? headerH);
      const gap = it.x - prevRight;
      // 半角スペース 1 文字分以上の空白がある場合に区切りを入れる
      // (Japanese char width ≈ font height; 半角スペースは ~50%)
      if (gap > charWidth * 0.4) {
        parts.push(' ');
      }
    }
    parts.push(it.str);
  }

  const name = parts.join('').replace(/  +/g, ' ').trim();

  if (!name) return null;

  // サブヘッダ／列ラベルを誤抽出していないかの最終チェック。
  // `※` を含む、または既知の列ラベル名と完全一致するものは無効扱い。
  if (name.includes('※')) return null;
  const KNOWN_LABELS = new Set([
    '生年月日',
    '種別',
    '種別(性別)',
    '種別（性別）',
    '取得区分',
    '区分',
    '被保険者区分',
    '整理番号',
    '基礎年金番号',
    '郵便番号',
    '被保険者住所',
  ]);
  if (KNOWN_LABELS.has(name)) return null;

  return name;
}

interface PageClassification {
  pageIndex: number; // 0-based (pdf-lib用)
  insurerName: string | null; // null = 付記/補足ページ
}

/**
 * PDFのすべてのページをスキャンして、通知ページ／付記ページに分類する
 */
async function classifyPages(pdfBuffer: Buffer): Promise<PageClassification[]> {
  ensurePdfjsWorkerConfigured();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    // ログを抑制
    verbosity: 0,
  }).promise;

  const out: PageClassification[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = toItemsWithPos(content.items as unknown[]);
      const insurerName = extractInsurerNameFromItems(items);
      out.push({ pageIndex: p - 1, insurerName });
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

/**
 * 同名衝突を回避するためのサフィックス付与
 *   山田太郎, 山田太郎, 山田太郎 → 山田太郎, 山田太郎_2, 山田太郎_3
 */
function disambiguateNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n}_${count}`;
  });
}

export interface SplitPdfResult {
  name: string;
  buffer: Buffer;
}

/**
 * 公文書PDF（社保通知書）を被保険者ごとに分割し、リネーム済みのバッファを返す
 *
 * 戻り値:
 *   - 通知ページが 1 件以上抽出できた場合: 各被保険者ごとに [通知ページ + 付記ページ群]
 *     を含む個別 PDF（被保険者名でリネーム済み）。
 *   - 通知ページが 0 件（被保険者氏名がどのページからも抽出できない）の場合: 空配列。
 *     呼び出し側は通常のリネーム経路にフォールバックすること。
 *
 * 付記ページの扱い:
 *   - 「被保険者氏名」ヘッダが無いページ = 付記/補足ページとして扱う
 *   - 各分割PDFには、選択した通知ページの後ろに付記ページ群を追加する
 *     （通知書本体の不服申立て案内などを毎PDFに含めるため）
 *   - PDF内のページ順序は元PDFのページ順を保持する
 */
export async function splitShahoKoubunshoPdf(
  pdfBuffer: Buffer,
  pdfFileName: string
): Promise<SplitPdfResult[]> {
  const title = getNoticeTitleFromPdfFileName(pdfFileName);
  if (!title) return [];

  const classifications = await classifyPages(pdfBuffer);

  const noticePages = classifications.filter((c) => c.insurerName !== null);
  const appendixPages = classifications.filter((c) => c.insurerName === null);

  if (noticePages.length === 0) {
    return [];
  }

  // 同名の衝突を回避
  const disambiguated = disambiguateNames(
    noticePages.map((p) => p.insurerName as string)
  );

  const sourceDoc = await PDFDocument.load(pdfBuffer);
  const appendixPageIndexes = appendixPages.map((p) => p.pageIndex);

  const results: SplitPdfResult[] = [];

  for (let i = 0; i < noticePages.length; i++) {
    const notice = noticePages[i];
    const displayName = disambiguated[i];

    // 通知ページ + 付記ページ群（元PDFの順序を保持）
    const pageIndexes = [notice.pageIndex, ...appendixPageIndexes].sort(
      (a, b) => a - b
    );

    const newDoc = await PDFDocument.create();
    const copied = await newDoc.copyPages(sourceDoc, pageIndexes);
    for (const cp of copied) newDoc.addPage(cp);

    const outBytes = await newDoc.save();
    // PDF抽出名は OS 不正文字 (/, :, * 等) を含み得るため必ず sanitize する。
    // ただし氏名内の半角スペース（姓-名の区切り）は保持する。
    const outName = `${sanitizeInsurerNameForFilename(displayName)}様_${title}.pdf`;

    results.push({
      name: outName,
      buffer: Buffer.from(outBytes),
    });
  }

  return results;
}
