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

  // N7xxxxx系の社会保険フォーマット
  const socialInsurancePatterns: Record<string, ProcedureType> = {
    N7100001: '取得', // 資格取得確認および標準報酬決定通知書
    N7130001: '取得', // 標準報酬決定通知書
    N7140001: '月額変更', // 標準報酬改定通知書
    N7150001: '算定基礎届', // 算定基礎届
    N7160001: '賞与', // 賞与支払届
    N7170003: '取得', // 被扶養者（異動）届
    N7200001: '取得', // 70歳以上被用者通知書
    N7210001: '月額変更', // 70歳以上被用者月額改定通知書
  };

  if (socialInsurancePatterns[rootTag]) {
    const type = socialInsurancePatterns[rootTag];
    // 社会保険：取得・喪失は個別PDF、それ以外は連結PDF
    // ただし、N7210001（70歳以上被用者月額改定）は個別PDF
    const pdfStrategy = (type === '取得' || type === '喪失' || rootTag === 'N7210001') ? 'individual' : 'combined';
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
