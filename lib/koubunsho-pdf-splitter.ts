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
import { sanitizeFileName } from './xml-parser';

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
}

/**
 * pdfjs の TextContent から `(str, x, y)` の配列を抽出
 */
function toItemsWithPos(textItems: unknown[]): TextItemWithPos[] {
  const out: TextItemWithPos[] = [];
  for (const raw of textItems) {
    const item = raw as { str?: string; transform?: number[] };
    if (!item || typeof item.str !== 'string' || !item.transform) continue;
    if (!item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    out.push({ str: item.str, x, y });
  }
  return out;
}

/**
 * 1ページ分のテキストアイテムから被保険者名を抽出する
 *
 * アルゴリズム:
 *   1. 「被保険者氏名」というラベルテキストを探す（ヘッダ位置 = headerX, headerY）
 *   2. ヘッダの直下 15〜45 pt のy範囲 + headerX-50 〜 headerX+90 のx範囲 にある
 *      テキストアイテムを取得（賞与は y-29、喪失は y-23 ほど下に存在。隣接列
 *      ヘッダの x ≒ headerX+95 と重ならないよう +90 で制限）
 *   3. x昇順にソートして連結 → 氏名
 *   4. 1文字も拾えなければ null（=このページは通知ページではない）
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

  // データ行の探索範囲
  const dataYmin = headerY - 45;
  const dataYmax = headerY - 15;
  const dataXmin = headerX - 50;
  const dataXmax = headerX + 90;

  const dataItems = items
    .filter(
      (it) =>
        it.y >= dataYmin &&
        it.y <= dataYmax &&
        it.x >= dataXmin &&
        it.x <= dataXmax
    )
    .sort((a, b) => a.x - b.x);

  if (dataItems.length === 0) return null;

  // 連結（PDFのテキスト抽出は通常スペースを含むので、内部スペースは保持）
  const name = dataItems
    .map((it) => it.str)
    .join('')
    .trim();

  if (!name) return null;
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
    // PDF抽出名は OS 不正文字 (/, :, * 等) を含み得るため必ず sanitize する
    const outName = `${sanitizeFileName(displayName)}様_${title}.pdf`;

    results.push({
      name: outName,
      buffer: Buffer.from(outBytes),
    });
  }

  return results;
}
