/**
 * PDF命名ロジック
 * 手続き種別に応じて適切なPDFファイル名を生成する
 */

import { ProcedureType } from './procedure-detector';
import { NamingInfo } from './xml-info-extractor';

/**
 * 元号略号付き日付を完全名・ゼロパディング除去形式に整形
 *   `R08年04月`     → `令和8年4月{suffix}`
 *   `R08年01月25日` → `令和8年1月25日{suffix}`
 * 該当しないフォーマットはそのまま返す。
 */
function formatEraDateForFilename(date: string, suffix: string = ''): string {
  const eraMap: Record<string, string> = { S: '昭和', H: '平成', R: '令和' };
  const ymd = date.match(/^([SHR])(\d+)年(\d+)月(\d+)日$/);
  if (ymd) {
    const era = eraMap[ymd[1]] ?? ymd[1];
    return `${era}${parseInt(ymd[2], 10)}年${parseInt(ymd[3], 10)}月${parseInt(ymd[4], 10)}日${suffix}`;
  }
  const ym = date.match(/^([SHR])(\d+)年(\d+)月$/);
  if (ym) {
    const era = eraMap[ym[1]] ?? ym[1];
    return `${era}${parseInt(ym[2], 10)}年${parseInt(ym[3], 10)}月${suffix}`;
  }
  return date;
}

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
      // 令和n年m月改定_被保険者名様_通知書名.pdf
      if (info.applicableDate || info.revisionDate) {
        const datePrefix = formatEraDateForFilename(
          (info.applicableDate || info.revisionDate)!,
          '改定'
        );

        if (info.firstInsurerName) {
          if (info.insurerCount > 1) {
            const othersCount = info.insurerCount - 1;
            return `${datePrefix}_${info.firstInsurerName}様他${othersCount}名_${info.noticeTitle}.pdf`;
          }
          return `${datePrefix}_${info.firstInsurerName}様_${info.noticeTitle}.pdf`;
        }
        return `${datePrefix}_${info.noticeTitle}.pdf`;
      }

      // 改定年月が取得できない場合
      if (info.firstInsurerName) {
        if (info.insurerCount > 1) {
          const othersCount = info.insurerCount - 1;
          return `${info.firstInsurerName}様他${othersCount}名_${info.noticeTitle}.pdf`;
        }
        return `${info.firstInsurerName}様_${info.noticeTitle}.pdf`;
      }
      return `${info.noticeTitle}.pdf`;

    case '算定基礎届':
      // 適用年月_被保険者名様_通知書名.pdf
      if (info.revisionDate) {
        if (info.firstInsurerName) {
          if (info.insurerCount > 1) {
            const othersCount = info.insurerCount - 1;
            return `${info.revisionDate}_${info.firstInsurerName}様他${othersCount}名_${info.noticeTitle}.pdf`;
          }
          return `${info.revisionDate}_${info.firstInsurerName}様_${info.noticeTitle}.pdf`;
        }
        return `${info.revisionDate}_${info.noticeTitle}.pdf`;
      }

      // 適用年月が取得できない場合
      if (info.firstInsurerName) {
        if (info.insurerCount > 1) {
          const othersCount = info.insurerCount - 1;
          return `${info.firstInsurerName}様他${othersCount}名_${info.noticeTitle}.pdf`;
        }
        return `${info.firstInsurerName}様_${info.noticeTitle}.pdf`;
      }
      return `${info.noticeTitle}.pdf`;

    case '賞与':
      // 令和n年m月d日_被保険者名様_通知書名.pdf
      if (info.bonusPaymentDate) {
        const bonusDatePrefix = formatEraDateForFilename(info.bonusPaymentDate);
        if (info.firstInsurerName) {
          if (info.insurerCount > 1) {
            const othersCount = info.insurerCount - 1;
            return `${bonusDatePrefix}_${info.firstInsurerName}様他${othersCount}名_${info.noticeTitle}.pdf`;
          }
          return `${bonusDatePrefix}_${info.firstInsurerName}様_${info.noticeTitle}.pdf`;
        }
        return `${bonusDatePrefix}_${info.noticeTitle}.pdf`;
      }

      // 賞与支払年月日が取得できない場合
      if (info.firstInsurerName) {
        if (info.insurerCount > 1) {
          const othersCount = info.insurerCount - 1;
          return `${info.firstInsurerName}様他${othersCount}名_${info.noticeTitle}.pdf`;
        }
        return `${info.firstInsurerName}様_${info.noticeTitle}.pdf`;
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
