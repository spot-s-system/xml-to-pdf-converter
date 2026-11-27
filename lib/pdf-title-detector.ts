/**
 * 同梱PDFの本文（1ページ目の冒頭）から帳票名を読み取り、固定ファイル名を決める。
 *
 * 背景:
 *   spot-s-admin の e-Gov申請一覧から公文書をDL（一括DL /「リネームアプリを使ってDL」）
 *   すると、フォルダ名は到達番号だけ（OS形式の `..._公文書_[労保]名称所在地変更_...`
 *   ではない）になる。労働局から返る受付印付きの控えPDFは、XML/XSL を伴わず
 *   `{到達番号}.pdf` ＋ `<acceptNo>…</acceptNo>` だけのXMLで届くため、
 *   フォルダ名にもXMLにも帳票の手掛かりが無く、リネームされずに残っていた。
 *   そこで PDF 本文の冒頭にある帳票タイトルから判定して救済する。
 */
import path from 'path';
import { pathToFileURL } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/** 到達番号（18桁）だけのPDFファイル名か */
export function isArrivalNumberPdfFileName(fileName: string): boolean {
  return /^\d{18}\.pdf$/i.test(fileName);
}

/**
 * 帳票タイトル → 固定ファイル名。上から順に判定する。
 * ファイル名は bulk-zip-processor の FIXED_NAME_MAP（OS形式フォルダ用）と揃える。
 */
const TITLE_RULES: Array<{ pattern: RegExp; fileName: string }> = [
  { pattern: /名称、?所在地等変更届/, fileName: '労働保険名称所在地変更届.pdf' },
  { pattern: /保険関係成立届/, fileName: '労働保険関係成立届.pdf' },
  { pattern: /概算・?確定保険料申告書/, fileName: '労働保険概算・確定保険料申告書.pdf' },
  { pattern: /概算保険料申告書/, fileName: '労働保険概算保険料申告書.pdf' },
];

/** 帳票タイトルを探す範囲（空白除去後の先頭文字数）。本文中の注記への誤マッチを避ける */
const TITLE_SEARCH_LENGTH = 400;

/** 空白（半角・全角・改行）を除去する。PDF本文は「名 称 、 所 在 地」のように字間が空く */
export function normalizePdfText(text: string): string {
  return text.replace(/[\s　]+/g, '');
}

/** 本文テキストから固定ファイル名を決める（該当なしは null） */
export function detectFixedNameFromPdfText(text: string): string | null {
  const head = normalizePdfText(text).slice(0, TITLE_SEARCH_LENGTH);
  for (const { pattern, fileName } of TITLE_RULES) {
    if (pattern.test(head)) return fileName;
  }
  return null;
}

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

/** PDF 1ページ目の本文テキストを取り出す */
export async function extractFirstPageText(pdfBuffer: Buffer): Promise<string> {
  ensurePdfjsWorkerConfigured();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    // 労働局の控えPDFは定義済みCMap（UniJIS-UCS2-HW-H 等）のCIDフォントで、
    // CMap を渡さないと本文テキストが取れない
    // pdfjs は末尾 `/` 必須（Windows の `\` 区切りは不可）
    cMapUrl:
      path.resolve(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps').replace(/\\/g, '/') + '/',
    cMapPacked: true,
    verbosity: 0,
  }).promise;
  try {
    if (doc.numPages < 1) return '';
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    return (content.items as Array<{ str?: string }>)
      .map((item) => item.str ?? '')
      .join(' ');
  } finally {
    await doc.destroy();
  }
}

/** PDF 本文から固定ファイル名を決める（読めない・該当なしは null） */
export async function detectFixedNameFromPdf(pdfBuffer: Buffer): Promise<string | null> {
  try {
    const text = await extractFirstPageText(pdfBuffer);
    return detectFixedNameFromPdfText(text);
  } catch (error) {
    console.error('Failed to read PDF text for title detection:', error);
    return null;
  }
}
