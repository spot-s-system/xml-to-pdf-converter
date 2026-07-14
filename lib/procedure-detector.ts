/**
 * 手続き種別判定ロジック
 * XMLの構造から手続きの種類を判定する
 */

export type ProcedureType =
  | '月額変更'
  | '算定基礎届'
  | '賞与'
  | '取得'
  | '喪失'
  | 'その他';

export interface ProcedureInfo {
  type: ProcedureType;
  category: '社会保険' | '労働保険' | '雇用保険' | '不明';
  // 複数人処理の戦略を決定
  pdfStrategy: 'individual' | 'combined'; // individual: 個別PDF, combined: 連結PDF
}

/**
 * XMLコンテンツから手続き種別を判定
 */
export function detectProcedureType(xmlContent: string): ProcedureInfo {
  // ルートタグを抽出
  const rootTagMatch = xmlContent.match(/<([A-Za-z0-9_-]+)[\s>]/);
  if (!rootTagMatch) {
    return { type: 'その他', category: '不明', pdfStrategy: 'combined' };
  }

  const rootTag = rootTagMatch[1];

  // N7xxxxx系の社会保険フォーマット（+ 育児休業終了時月額変更の N2050001）
  const socialInsurancePatterns: Record<string, ProcedureType> = {
    // 育児休業終了時月額変更届の結果通知（標準報酬改定通知書）。
    // 7140001（通常の月額変更）と違い、被保険者単位で日付プレフィックス無しの
    // 「{被保険者名}様_{通知書名}.pdf」に命名したいので、日付プレフィックスを
    // 付与する '月額変更' ではなく 'その他' として扱う（pdf-naming の 'その他'
    // 分岐が `{name}様_{title}.pdf` を生成する）。1ファイル1被保険者。
    N2050001: 'その他',
    N7012001: 'その他', // 新規適用通知書（会社単位）
    N7027001: 'その他', // 厚生年金保険養育期間標準報酬月額特例申出受理通知書（1人1ファイル）
    N7100001: '取得', // 資格取得確認および標準報酬決定通知書
    N7120002: '喪失', // 資格喪失確認通知書
    N7130001: '算定基礎届', // 標準報酬決定通知書（定時決定＝算定基礎の結果）→ 複数名連結PDF(B)
    N7140001: '月額変更', // 標準報酬改定通知書
    N7150001: '賞与', // 健康保険・厚生年金保険被保険者賞与額決定通知書
    N7170003: '取得', // 健康保険被扶養者（異動）決定通知書
    N7180001: '取得', // 70歳以上被用者該当通知書（資格取得相当）
    N7200001: '取得', // 70歳以上被用者通知書
    N7210001: '月額変更', // 70歳以上被用者月額改定通知書
    N7220001: '賞与', // 70歳以上被用者標準賞与額相当額のお知らせ
  };

  if (socialInsurancePatterns[rootTag]) {
    const type = socialInsurancePatterns[rootTag];
    // 社会保険：取得・喪失・月額変更は個別PDF(A)、算定基礎届・賞与・その他は連結PDF(B)
    const pdfStrategy =
      (type === '取得' || type === '喪失' || type === '月額変更')
        ? 'individual'
        : 'combined';
    return {
      type,
      category: '社会保険',
      pdfStrategy,
    };
  }

  // DataRoot形式（社会保険の電子申請）
  if (rootTag === 'DataRoot') {
    const formIdMatch = xmlContent.match(/<様式ID>(\d+)<\/様式ID>/);
    if (formIdMatch) {
      const formId = formIdMatch[1];

      // 様式IDの末尾から判定
      if (formId.includes('30839')) {
        return { type: '取得', category: '社会保険', pdfStrategy: 'individual' };
      }
      if (formId.includes('30840')) {
        return { type: '喪失', category: '社会保険', pdfStrategy: 'individual' };
      }
      if (formId.includes('30841')) {
        return { type: '取得', category: '社会保険', pdfStrategy: 'individual' };
      }
    }

    return { type: 'その他', category: '社会保険', pdfStrategy: 'combined' };
  }

  // DOC形式（雇用保険）
  if (rootTag === 'DOC') {
    const titleMatch = xmlContent.match(/<TITLE>(.*?)<\/TITLE>/);
    if (titleMatch) {
      const title = titleMatch[1];

      if (title.includes('資格取得')) {
        // 雇用保険：取得は個別PDF
        return { type: '取得', category: '雇用保険', pdfStrategy: 'individual' };
      }
      if (title.includes('資格喪失')) {
        // 雇用保険：喪失は個別PDF
        return { type: '喪失', category: '雇用保険', pdfStrategy: 'individual' };
      }
    }

    return { type: 'その他', category: '雇用保険', pdfStrategy: 'combined' };
  }

  // デフォルト（労働保険などその他）
  return { type: 'その他', category: '不明', pdfStrategy: 'combined' };
}

/**
 * ファイル名から手続き種別を推測（バックアップ用）
 */
export function detectProcedureTypeFromFileName(
  fileName: string
): ProcedureInfo {
  if (fileName.includes('月額変更')) {
    return { type: '月額変更', category: '社会保険', pdfStrategy: 'combined' };
  }
  if (fileName.includes('算定基礎')) {
    return { type: '算定基礎届', category: '社会保険', pdfStrategy: 'combined' };
  }
  if (fileName.includes('賞与')) {
    return { type: '賞与', category: '社会保険', pdfStrategy: 'combined' };
  }
  if (fileName.includes('資格取得') || fileName.includes('被扶養')) {
    if (fileName.includes('雇保')) {
      return { type: '取得', category: '雇用保険', pdfStrategy: 'individual' };
    }
    return { type: '取得', category: '社会保険', pdfStrategy: 'individual' };
  }
  if (fileName.includes('資格喪失')) {
    if (fileName.includes('雇保')) {
      return { type: '喪失', category: '雇用保険', pdfStrategy: 'individual' };
    }
    return { type: '喪失', category: '社会保険', pdfStrategy: 'individual' };
  }

  return { type: 'その他', category: '不明', pdfStrategy: 'combined' };
}
