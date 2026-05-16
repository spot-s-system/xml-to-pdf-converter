/**
 * XMLから情報抽出ロジック
 * PDF命名に必要な情報をXMLから抽出する
 */

import { ProcedureType } from './procedure-detector';
import { SHAHO_NOTICE_TITLES } from './document-names';

export interface NamingInfo {
  // 被保険者情報
  firstInsurerName?: string;
  insurerCount: number;
  allInsurers?: InsurerInfo[]; // 全被保険者の個別情報

  // 日付情報
  revisionDate?: string; // 改定年月 (例: "R07年09月")
  applicableDate?: string; // 適用年月（月額変更用）(例: "R07年09月")
  bonusPaymentDate?: string; // 賞与支払年月日 (例: "R07年06月15日")

  // 通知書名
  noticeTitle: string;
}

// 個別の被保険者情報
export interface InsurerInfo {
  name: string;
  insurerNumber?: string; // 被保険者番号
}

/**
 * 元号コードを文字に変換
 *
 * 受け取り得る形式（公文書XMLで実際に観測されたもの）:
 *   - 数字コード: '5'=昭和 / '8'=平成 / '9'=令和
 *   - 英字略号:   'S' / 'H' / 'R'
 *   - フルテキスト: '昭和' / '平成' / '令和'  ← N7210001 等の <月額改定年月_元号> はこれ
 *
 * フルテキストを変換できないと revisionDate が "令和07年11月" のように
 * 略号を期待する後続処理（pdf-naming.ts の formatEraDateForFilename 等）で
 * フォールスルーし、suffix「改定」欠落・年のゼロ埋め残留などの不整合が発生する。
 */
function convertEraCode(code: string): string {
  const eraMap: Record<string, string> = {
    '5': 'S',
    '8': 'H',
    '9': 'R',
    S: 'S',
    H: 'H',
    R: 'R',
    昭和: 'S',
    平成: 'H',
    令和: 'R',
  };
  return eraMap[code] || code;
}

/**
 * XMLから通知書名を抽出
 */
export function extractNoticeTitle(
  xmlContent: string,
  kagazmiXmlContent?: string
): string {
  // N7xxxxx形式のルートタグから N を剥がして通知書名を決定
  const rootTagMatch = xmlContent.match(/<N(7\d{6})[\s>]/);
  if (rootTagMatch) {
    const noticeId = rootTagMatch[1];
    if (SHAHO_NOTICE_TITLES[noticeId]) {
      return SHAHO_NOTICE_TITLES[noticeId];
    }
  }

  // DOC形式の<TITLE>から抽出（kagamiの場合は<TITLE>を優先）
  const titleMatch = xmlContent.match(/<TITLE>(.*?)<\/TITLE>/);
  if (titleMatch) {
    let title = titleMatch[1].trim();
    // 「の件」を除去
    title = title.replace(/の件$/, '').trim();
    return title;
  }

  // kagami.xmlの場合で<TITLE>がない場合のみ<APPTITLE>を使用
  if (kagazmiXmlContent && xmlContent === kagazmiXmlContent) {
    const appTitleMatch = kagazmiXmlContent.match(
      /<APPTITLE>(.*?)<\/APPTITLE>/
    );
    if (appTitleMatch) {
      return appTitleMatch[1].trim();
    }
  }

  // デフォルト
  return '通知書';
}

/**
 * N7xxxxx形式（社会保険）から情報抽出
 */
export function extractFromSocialInsurance(
  xmlContent: string,
  procedureType: ProcedureType
): Partial<NamingInfo> {
  const info: Partial<NamingInfo> = {
    insurerCount: 0,
    allInsurers: [],
  };

  // 全被保険者の情報を個別に抽出
  const insurerBlocks = xmlContent.match(/<_被保険者>[\s\S]*?<\/_被保険者>/g);
  if (insurerBlocks) {
    info.insurerCount = insurerBlocks.length;

    insurerBlocks.forEach((block) => {
      // 名前抽出の優先順位:
      //   1. 被用者漢字氏名 (70歳以上)
      //   2. 被保険者漢字氏名 / 被保険者氏名
      //   3. 被用者カナ氏名  (70歳以上 漢字登録なし向けフォールバック)
      //   4. 被保険者カナ氏名 (外国籍など漢字登録なしのケース向けフォールバック)
      //
      // 例: <被保険者漢字氏名><![CDATA[]]></被保険者漢字氏名> のように
      // 漢字氏名が CDATA 空で送られてくる外国人被保険者ケースでは、
      // カナ氏名 (ｱﾙﾇ ﾌﾛｰﾚﾝｽ ｼﾞﾖｾﾞﾌｲﾝ ﾃﾚｽﾞ 等) にフォールバックする。
      // 半角カナはファイル名に使用可能 (Windows/macOS とも対応)。
      const pickName = (re: RegExp): string => {
        const m = block.match(re);
        return m ? m[1].trim() : '';
      };
      let name =
        pickName(/<被用者漢字氏名>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/被用者漢字氏名>/) ||
        pickName(/<被保険者(?:漢字)?氏名>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/被保険者(?:漢字)?氏名>/);
      if (!name) {
        name =
          pickName(/<被用者カナ氏名>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/被用者カナ氏名>/) ||
          pickName(/<被保険者カナ氏名>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/被保険者カナ氏名>/);
      }

      const numberMatch = block.match(/<被保険者番号>(.*?)<\/被保険者番号>/);

      if (name) {
        const insurerInfo: InsurerInfo = {
          name,
          insurerNumber: numberMatch ? numberMatch[1].trim() : undefined,
        };
        info.allInsurers!.push(insurerInfo);
      }
    });

    // 最初の被保険者名を設定
    if (info.allInsurers!.length > 0) {
      info.firstInsurerName = info.allInsurers![0].name;
    }
  } else {
    // _被保険者ブロックがない場合、従来の方法で抽出
    // 漢字氏名 → カナ氏名 の順でフォールバック (外国人ケース対応)
    const pickRootName = (re: RegExp): string => {
      const m = xmlContent.match(re);
      return m ? m[1].trim() : '';
    };
    const insurerName =
      pickRootName(/<被保険者(?:漢字)?氏名>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/被保険者(?:漢字)?氏名>/) ||
      pickRootName(/<被保険者カナ氏名>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/被保険者カナ氏名>/);

    if (insurerName) {
      info.firstInsurerName = insurerName;
      info.insurerCount = 1;
      info.allInsurers!.push({ name: insurerName });
    }
  }

  // 改定年月を抽出（月額変更・算定基礎届の場合）
  if (procedureType === '月額変更' || procedureType === '算定基礎届') {
    // N7210001の場合は月額改定年月を使用
    const rootTagMatch = xmlContent.match(/<(N7210001)[\s>]/);
    if (rootTagMatch) {
      // 70歳以上被用者の場合は被保険者ブロックから抽出
      const firstInsurerBlock = xmlContent.match(/<_被保険者>[\s\S]*?<\/_被保険者>/);
      if (firstInsurerBlock) {
        const block = firstInsurerBlock[0];
        const eraMatch = block.match(/<月額改定年月_元号>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/月額改定年月_元号>/);
        const yearMatch = block.match(/<月額改定年月_年>(?:<!\[CDATA\[)?\s*(\d+)(?:\]\]>)?<\/月額改定年月_年>/);
        const monthMatch = block.match(/<月額改定年月_月>(\d+)<\/月額改定年月_月>/);

        if (eraMatch && yearMatch && monthMatch) {
          const era = convertEraCode(eraMatch[1]);
          const year = yearMatch[1].padStart(2, '0');
          const month = monthMatch[1].padStart(2, '0');
          info.revisionDate = `${era}${year}年${month}月`;
        }
      }
    } else {
      // N7140001など通常の月額変更の場合も被保険者ブロックから抽出
      const firstInsurerBlock = xmlContent.match(/<_被保険者>[\s\S]*?<\/_被保険者>/);
      if (firstInsurerBlock) {
        const block = firstInsurerBlock[0];
        const eraMatch = block.match(/<改定年月_元号>(.*?)<\/改定年月_元号>/);
        const yearMatch = block.match(/<改定年月_年>(.*?)<\/改定年月_年>/);
        const monthMatch = block.match(/<改定年月_月>(.*?)<\/改定年月_月>/);

        if (eraMatch && yearMatch && monthMatch) {
          const era = convertEraCode(eraMatch[1]);
          const year = yearMatch[1].padStart(2, '0');
          const month = monthMatch[1].padStart(2, '0');
          info.revisionDate = `${era}${year}年${month}月`;
        }
      }
    }
  }

  // 適用年月を抽出（月額変更・算定基礎届で使用）
  // ルート → なければ被保険者ブロックの順に試す
  {
    let applicableEraMatch = xmlContent.match(/<適用年月_元号>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/適用年月_元号>/);
    let applicableYearMatch = xmlContent.match(/<適用年月_年>(?:<!\[CDATA\[)?\s*(\d+)(?:\]\]>)?<\/適用年月_年>/);
    let applicableMonthMatch = xmlContent.match(/<適用年月_月>(?:<!\[CDATA\[)?\s*(\d+)(?:\]\]>)?<\/適用年月_月>/);

    if (!applicableEraMatch || !applicableYearMatch || !applicableMonthMatch) {
      const firstInsurerBlock = xmlContent.match(/<_被保険者>[\s\S]*?<\/_被保険者>/);
      if (firstInsurerBlock) {
        const block = firstInsurerBlock[0];
        applicableEraMatch = applicableEraMatch || block.match(/<適用年月_元号>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/適用年月_元号>/);
        applicableYearMatch = applicableYearMatch || block.match(/<適用年月_年>(?:<!\[CDATA\[)?\s*(\d+)(?:\]\]>)?<\/適用年月_年>/);
        applicableMonthMatch = applicableMonthMatch || block.match(/<適用年月_月>(?:<!\[CDATA\[)?\s*(\d+)(?:\]\]>)?<\/適用年月_月>/);
      }
    }

    if (applicableEraMatch && applicableYearMatch && applicableMonthMatch) {
      const era = convertEraCode(applicableEraMatch[1]);
      const year = applicableYearMatch[1].padStart(2, '0');
      const month = applicableMonthMatch[1].padStart(2, '0');
      info.applicableDate = `${era}${year}年${month}月`;
    }
  }

  // 賞与支払年月日を抽出（賞与の場合）
  if (procedureType === '賞与') {
    const bonusEraMatch = xmlContent.match(/<賞与支払年月日_元号>(.*?)<\/賞与支払年月日_元号>/);
    const bonusYearMatch = xmlContent.match(/<賞与支払年月日_年>(.*?)<\/賞与支払年月日_年>/);
    const bonusMonthMatch = xmlContent.match(/<賞与支払年月日_月>(.*?)<\/賞与支払年月日_月>/);
    const bonusDayMatch = xmlContent.match(/<賞与支払年月日_日>(.*?)<\/賞与支払年月日_日>/);

    if (bonusEraMatch && bonusYearMatch && bonusMonthMatch && bonusDayMatch) {
      const era = convertEraCode(bonusEraMatch[1]);
      const year = bonusYearMatch[1].padStart(2, '0');
      const month = bonusMonthMatch[1].padStart(2, '0');
      const day = bonusDayMatch[1].padStart(2, '0');
      info.bonusPaymentDate = `${era}${year}年${month}月${day}日`;
    }
  }

  return info;
}

/**
 * DataRoot形式（社会保険電子申請）から情報抽出
 */
export function extractFromDataRoot(xmlContent: string): Partial<NamingInfo> {
  const info: Partial<NamingInfo> = {
    insurerCount: 1,
    allInsurers: [],
  };

  // 被保険者名を複数のパターンで試行
  const namePatterns = [
    // P1_氏名x漢字氏名（最も一般的）
    /<P1_氏名x漢字氏名>(.*?)<\/P1_氏名x漢字氏名>/,
    // P1_被保険者x漢字氏名
    /<P1_被保険者x漢字氏名>(.*?)<\/P1_被保険者x漢字氏名>/,
    // P1_被保険者氏名x漢字氏名
    /<P1_被保険者氏名x漢字氏名>(.*?)<\/P1_被保険者氏名x漢字氏名>/,
    // P1_氏名xカナ氏名（フォールバック）
    /<P1_氏名xカナ氏名>(.*?)<\/P1_氏名xカナ氏名>/,
  ];

  for (const pattern of namePatterns) {
    const insurerNameMatch = xmlContent.match(pattern);
    if (insurerNameMatch && insurerNameMatch[1].trim()) {
      const name = insurerNameMatch[1].trim();
      info.firstInsurerName = name;
      info.allInsurers!.push({ name });
      break;
    }
  }

  // 取得年月日
  const eraMatch = xmlContent.match(
    /<P1_被保険者x取得年月日>[\s\S]*?<P1_元号>(.*?)<\/P1_元号>/
  );
  const yearMatch = xmlContent.match(
    /<P1_被保険者x取得年月日>[\s\S]*?<P1_年>(.*?)<\/P1_年>/
  );
  const monthMatch = xmlContent.match(
    /<P1_被保険者x取得年月日>[\s\S]*?<P1_月>(.*?)<\/P1_月>/
  );
  const dayMatch = xmlContent.match(
    /<P1_被保険者x取得年月日>[\s\S]*?<P1_日>(.*?)<\/P1_日>/
  );

  if (eraMatch && yearMatch && monthMatch && dayMatch) {
    const era = convertEraCode(eraMatch[1]);
    const year = yearMatch[1].padStart(2, '0');
    const month = monthMatch[1].padStart(2, '0');
    const day = dayMatch[1].padStart(2, '0');
    info.revisionDate = `${era}${year}年${month}月${day}日`;
  }

  return info;
}

/**
 * DOC形式（雇用保険）から情報抽出
 */
export function extractFromEmploymentInsurance(
  xmlContent: string
): Partial<NamingInfo> {
  const info: Partial<NamingInfo> = {
    insurerCount: 1,
  };

  // 宛先の氏名
  const nameMatch = xmlContent.match(/<NAME>(.*?)<\/NAME>/);
  if (nameMatch) {
    info.firstInsurerName = nameMatch[1].trim();
  }

  // 複数人の判定（PDFファイル参照から）
  const pdfReferences = xmlContent.match(/Reference URI="[^"]*-\d{4}_[^"]*\.pdf"/g);
  if (pdfReferences && pdfReferences.length > 0) {
    // 連番パターンを検出
    const uniqueNumbers = new Set<string>();
    pdfReferences.forEach((ref) => {
      const match = ref.match(/-(\d{4})_/);
      if (match) {
        uniqueNumbers.add(match[1]);
      }
    });
    info.insurerCount = Math.max(uniqueNumbers.size, 1);
  }

  return info;
}

/**
 * XMLコンテンツとkagami.xmlから命名情報を抽出
 */
export function extractNamingInfo(
  xmlContent: string,
  procedureType: ProcedureType,
  kagazmiXmlContent?: string
): NamingInfo {
  let info: Partial<NamingInfo> = {
    insurerCount: 0,
    allInsurers: [],
  };

  // XMLの形式に応じて情報を抽出
  if (xmlContent.includes('<DataRoot>')) {
    info = { ...info, ...extractFromDataRoot(xmlContent) };
  } else if (xmlContent.includes('<DOC')) {
    info = { ...info, ...extractFromEmploymentInsurance(xmlContent) };
  } else if (xmlContent.match(/<N7\d{6}>/)) {
    info = { ...info, ...extractFromSocialInsurance(xmlContent, procedureType) };
  }

  // 通知書名を抽出
  const noticeTitle = extractNoticeTitle(xmlContent, kagazmiXmlContent);

  return {
    firstInsurerName: info.firstInsurerName || '',
    insurerCount: info.insurerCount || 0,
    allInsurers: info.allInsurers || [],
    revisionDate: info.revisionDate,
    applicableDate: info.applicableDate,
    bonusPaymentDate: info.bonusPaymentDate,
    noticeTitle,
  };
}
