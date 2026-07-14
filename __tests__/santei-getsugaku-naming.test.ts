/**
 * 算定基礎届(B連結) / 月額変更(A個別) のファイル名生成回帰テスト
 *
 * 算定基礎届の XML→PDF 経路は integration fixture が無いため、命名ロジックを
 * ユニットレベルで固定する。
 *   - 算定基礎届(7130001): 複数名を1PDFに統合し「令和{n}年度算定_{名前}様他N名_通知書名.pdf」
 *   - 月額変更(7140001/7210001): 被保険者ごと個別「令和{n}年{m}月改定_{名前}様_通知書名.pdf」
 */
import { describe, it, expect } from 'vitest';
import {
  generateSafePdfFileName,
  generateIndividualPdfFileName,
} from '../lib/pdf-naming';
import { applyShahoSanteiKisoYearPrefix } from '../lib/bulk-zip-processor';
import type { NamingInfo } from '../lib/xml-info-extractor';

const SANTEI_TITLE = '健康保険・厚生年金保険被保険者標準報酬決定通知書';
const GETSUGAKU_TITLE = '健康保険・厚生年金保険被保険者標準報酬改定通知書';

describe('算定基礎届(B連結) 命名', () => {
  // 算定基礎フォルダ + 7130001 + 適用年月 R07年09月 を想定
  const folderName = '0001_株式会社テスト_[社保]算定基礎_公文書_1';
  const xml = '<N7130001></N7130001>';

  it('複数名 → 令和{n}年度算定_{先頭名}様他N名_標準報酬決定通知書.pdf', () => {
    const info: NamingInfo = {
      firstInsurerName: '鈴木格',
      insurerCount: 3,
      allInsurers: [{ name: '鈴木格' }, { name: '山田太郎' }, { name: '佐藤花子' }],
      applicableDate: 'R07年09月',
      noticeTitle: SANTEI_TITLE,
    };
    const base = generateSafePdfFileName('算定基礎届', info);
    const withPrefix = applyShahoSanteiKisoYearPrefix(base, folderName, info.applicableDate, xml);
    expect(withPrefix).toBe(`令和7年度算定_鈴木格様他2名_${SANTEI_TITLE}.pdf`);
  });

  it('1名のみ → 「他N名」を省略', () => {
    const info: NamingInfo = {
      firstInsurerName: '鈴木格',
      insurerCount: 1,
      allInsurers: [{ name: '鈴木格' }],
      applicableDate: 'R07年09月',
      noticeTitle: SANTEI_TITLE,
    };
    const base = generateSafePdfFileName('算定基礎届', info);
    const withPrefix = applyShahoSanteiKisoYearPrefix(base, folderName, info.applicableDate, xml);
    expect(withPrefix).toBe(`令和7年度算定_鈴木格様_${SANTEI_TITLE}.pdf`);
  });

  it('賞与など算定基礎以外には年度プレフィックスを付与しない', () => {
    const bonusFolder = '0002_株式会社テスト_[社保]賞与支払届_公文書_1';
    const base = `山田太郎様_${SANTEI_TITLE}.pdf`;
    // isSanteiKisoContext が false のため素通し
    expect(applyShahoSanteiKisoYearPrefix(base, bonusFolder, 'R07年06月', '<N7150001></N7150001>')).toBe(base);
  });
});

describe('月額変更(A個別) 命名', () => {
  it('改定年月あり → 令和{n}年{m}月改定_{名前}様_標準報酬改定通知書.pdf', () => {
    const name = generateIndividualPdfFileName('月額変更', '山田太郎', GETSUGAKU_TITLE, {
      revisionDate: 'R07年11月',
    });
    expect(name).toBe(`令和7年11月改定_山田太郎様_${GETSUGAKU_TITLE}.pdf`);
  });

  it('applicableDate を優先して使用する', () => {
    const name = generateIndividualPdfFileName('月額変更', '佐藤花子', GETSUGAKU_TITLE, {
      applicableDate: 'R07年09月',
      revisionDate: 'R07年11月',
    });
    expect(name).toBe(`令和7年9月改定_佐藤花子様_${GETSUGAKU_TITLE}.pdf`);
  });

  it('改定年月が取れない場合は日付プレフィックス無し', () => {
    const name = generateIndividualPdfFileName('月額変更', '山田太郎', GETSUGAKU_TITLE);
    expect(name).toBe(`山田太郎様_${GETSUGAKU_TITLE}.pdf`);
  });
});

describe('育児休業終了時月額変更(N2050001) 命名', () => {
  // 7140001（通常の月額変更）と通知書名は同じだが、被保険者単位・日付プレフィックス
  // 無しの「{被保険者名}様_{通知書名}.pdf」で出力する（procedure-detector で 'その他'
  // 扱い）。氏名内の全角スペースは pdf-naming.sanitizeFileName が半角1個に collapse する。
  const folderName = '0001_株式会社テスト_[社保]育児休業終了時月額変更届_公文書_1';
  const xml = '<N2050001></N2050001>';

  it('{被保険者名}様_標準報酬改定通知書.pdf（日付プレフィックス無し）', () => {
    const info: NamingInfo = {
      firstInsurerName: '山田　花子', // 全角スペース入り（架空氏名）
      insurerCount: 1,
      allInsurers: [{ name: '山田　花子' }],
      noticeTitle: GETSUGAKU_TITLE,
    };
    const name = generateSafePdfFileName('その他', info);
    expect(name).toBe(`山田 花子様_${GETSUGAKU_TITLE}.pdf`);
  });

  it('育児(終了時月変)フォルダには算定年度プレフィックスを付与しない', () => {
    const base = `山田 花子様_${GETSUGAKU_TITLE}.pdf`;
    // isSanteiKisoContext が false（[社保]育児… かつ N2050001）なので素通し
    expect(applyShahoSanteiKisoYearPrefix(base, folderName, 'R08年07月', xml)).toBe(base);
  });
});
