import { sanitizeFileName } from "./xml-parser";

/**
 * 通知書番号から正式な通知書名へのマッピング
 */

export const DOCUMENT_NAMES: { [key: string]: string } = {
  "7130001": "健康保険・厚生年金保険被保険者標準報酬決定通知書",
  "7200001": "厚生年金保険70歳以上被用者標準報酬月額相当額決定のお知らせ",
  "henrei": "返戻のお知らせ",
  "kagami": "日本年金機構からのお知らせ",
};

/**
 * 通知書番号から通知書名を取得
 */
export function getDocumentName(documentType: string): string {
  return DOCUMENT_NAMES[documentType] || documentType;
}

/**
 * 被保険者名リストから「様」付きファイル名を生成
 * @param names 被保険者名のリスト
 * @returns "神山加津枝様" or "神山加津枝様他1名"
 */
export function formatInsuredPersonNames(names: string[]): string {
  if (names.length === 0) {
    return "";
  }

  const firstName = sanitizeFileName(names[0]);
  if (names.length === 1) {
    return `${firstName}様`;
  }

  const othersCount = names.length - 1;
  return `${firstName}様他${othersCount}名`;
}

/**
 * PDFファイル名を生成
 * @param names 被保険者名のリスト
 * @param documentType 通知書番号（7130001, 7200001等）
 * @returns "{名前}様{他N名}_{通知書名}.pdf"
 */
export function generatePdfFilename(
  names: string[],
  documentType: string
): string {
  const personPart = formatInsuredPersonNames(names);
  const documentName = getDocumentName(documentType);
  return `${personPart}_${documentName}.pdf`;
}
