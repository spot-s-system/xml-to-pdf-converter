/**
 * PDF命名ロジック
 * 手続き種別に応じて適切なPDFファイル名を生成する
 */

import { ProcedureType } from './procedure-detector';
import { NamingInfo } from './xml-info-extractor';

/**
 * PDF命名規則に従ってファイル名を生成
 */
export function generatePdfFileName(
  procedureType: ProcedureType,
  info: NamingInfo
): string {
  // kagamiの場合は常に「表紙.pdf」
  if (info.noticeTitle === '日本年金機構からのお知らせ' ||
      info.noticeTitle.includes('表紙')) {
    return '表紙.pdf';
  }

  switch (procedureType) {
    case '月額変更':
      // 適用年月_通知書名.pdf
      if (info.applicableDate) {
        return `${info.applicableDate}_${info.noticeTitle}.pdf`;
      }
      // 適用年月が取得できない場合は改定年月で代替
      if (info.revisionDate) {
        return `${info.revisionDate}_${info.noticeTitle}.pdf`;
      }
      return `${info.noticeTitle}.pdf`;

    case '算定基礎届':
      // 適用年月_通知書名.pdf
      if (info.revisionDate) {
        return `${info.revisionDate}_${info.noticeTitle}.pdf`;
      }
      return `${info.noticeTitle}.pdf`;

    case '賞与':
      // 賞与支払年月日_通知書名.pdf
      if (info.bonusPaymentDate) {
        return `${info.bonusPaymentDate}_${info.noticeTitle}.pdf`;
      }
      return `${info.noticeTitle}.pdf`;

    case '取得':
    case '喪失':
      // 被保険者名様_通知書名.pdf
      // または 被保険者名様他○名_通知書名.pdf
      if (info.firstInsurerName) {
        if (info.insurerCount > 1) {
          const othersCount = info.insurerCount - 1;
          return `${info.firstInsurerName}様他${othersCount}名_${info.noticeTitle}.pdf`;
        }
        return `${info.firstInsurerName}様_${info.noticeTitle}.pdf`;
      }
      // 被保険者名が取得できない場合は通知書名のみ
      return `${info.noticeTitle}.pdf`;

    case 'その他':
    default:
      // 被保険者名があれば含める
      if (info.firstInsurerName) {
        if (info.insurerCount > 1) {
          const othersCount = info.insurerCount - 1;
          return `${info.firstInsurerName}様他${othersCount}名_${info.noticeTitle}.pdf`;
        }
        return `${info.firstInsurerName}様_${info.noticeTitle}.pdf`;
      }
      // 被保険者名がない場合は通知書名のみ
      return `${info.noticeTitle}.pdf`;
  }
}

/**
 * ファイル名を安全な形式にサニタイズ
 * OSで禁止されている文字を全角に置換
 */
export function sanitizeFileName(fileName: string): string {
  const replacements: Record<string, string> = {
    '/': '／',
    '\\': '＼',
    ':': '：',
    '*': '＊',
    '?': '？',
    '"': '"',
    '<': '＜',
    '>': '＞',
    '|': '｜',
  };

  let sanitized = fileName;
  for (const [char, replacement] of Object.entries(replacements)) {
    sanitized = sanitized.replace(new RegExp(`\\${char}`, 'g'), replacement);
  }

  // 連続する空白を1つに
  sanitized = sanitized.replace(/\s+/g, ' ');

  // 先頭・末尾の空白を削除
  sanitized = sanitized.trim();

  // ファイル名が空の場合のフォールバック
  if (!sanitized || sanitized === '.pdf') {
    return '通知書.pdf';
  }

  return sanitized;
}

/**
 * PDF命名（サニタイズ込み）
 */
export function generateSafePdfFileName(
  procedureType: ProcedureType,
  info: NamingInfo
): string {
  const fileName = generatePdfFileName(procedureType, info);
  return sanitizeFileName(fileName);
}

/**
 * 個別被保険者用のPDF命名
 */
export function generateIndividualPdfFileName(
  procedureType: ProcedureType,
  insurerName: string,
  noticeTitle: string
): string {
  // 社会保険・雇用保険の取得・喪失は「被保険者名様_通知書名.pdf」
  if (procedureType === '取得' || procedureType === '喪失') {
    return sanitizeFileName(`${insurerName}様_${noticeTitle}.pdf`);
  }

  // その他は通常の命名規則を適用
  return sanitizeFileName(`${noticeTitle}.pdf`);
}
