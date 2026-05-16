import { describe, it, expect } from 'vitest';
import {
  renamePdfIfNeeded,
  extractInsurerNameFromFolderName,
  extractInsurerNameFromShahoFolder,
  extractRoudouHokenKoubunshoInfo,
  getShahoPerPersonRenameTitle,
  getFixedKoubunshoFilename,
  isLegacyEraDatePrefixedPdf,
  isApplicationCopyFolder,
  applyShahoFolderNameFallbacks,
} from '@/lib/bulk-zip-processor';
import type { NamingInfo } from '@/lib/xml-info-extractor';

describe('extractInsurerNameFromFolderName — [雇保] フォルダから被保険者名抽出', () => {
  it('4フィールド構造 (seq_会社_名前_[雇保]xxx)', () => {
    const folder = '0013_株式会社1SEC_川村 夏菜_[雇保]資格喪失(離職票交付あり)_公文書_1';
    expect(extractInsurerNameFromFolderName(folder)).toBe('川村 夏菜');
  });

  it('5フィールド構造 (seq_会社_番号_名前_[雇保]xxx)', () => {
    const folder = '0001_株式会社A_2971676_鈴木 花子_[雇保]育児休業出生後休業給付_公文書_1';
    expect(extractInsurerNameFromFolderName(folder)).toBe('鈴木 花子');
  });

  it('資格取得もマッチする', () => {
    const folder = '0005_株式会社X_田中太郎_[雇保]資格取得_公文書_1';
    expect(extractInsurerNameFromFolderName(folder)).toBe('田中太郎');
  });

  it('育児時短就業給付もマッチする', () => {
    const folder = '0002_株式会社B_山田 花子_[雇保]育児時短就業給付_公文書_1';
    expect(extractInsurerNameFromFolderName(folder)).toBe('山田 花子');
  });

  it('パス長切り詰めで手続き種別が途中で切れていても抽出できる', () => {
    const folder = '0013_株式会社1SEC_川村 夏菜_[雇保]資格喪失(離職票・・・';
    expect(extractInsurerNameFromFolderName(folder)).toBe('川村 夏菜');
  });

  it('他系統（高年齢雇用継続給付・介護休業給付金など）は誤マッチしない', () => {
    const folder = '0010_株式会社C_山田太郎_[雇保]高年齢雇用継続給付_公文書_1';
    expect(extractInsurerNameFromFolderName(folder)).toBeNull();

    const folder2 = '0011_株式会社C_山田太郎_[雇保]介護休業給付金_公文書_1';
    expect(extractInsurerNameFromFolderName(folder2)).toBeNull();
  });

  it('[雇保] 以外のフォルダは null を返す', () => {
    expect(extractInsurerNameFromFolderName('0001_株式会社A_山田太郎_[社保]資格取得_公文書_1')).toBeNull();
  });
});

describe('extractInsurerNameFromShahoFolder — [社保] フォルダから被保険者名抽出', () => {
  it('5フィールド構造から抽出', () => {
    const folder = '0001_株式会社A_2971676_鈴木花子_[社保]資格取得_公文書_1';
    expect(extractInsurerNameFromShahoFolder(folder)).toBe('鈴木花子');
  });

  it('パス長切り詰めにも対応', () => {
    expect(extractInsurerNameFromShahoFolder('0001_株式会社A_山田太郎_[社保]・・・')).toBe('山田太郎');
  });

  it('[社保] が含まれないフォルダ名は null', () => {
    expect(extractInsurerNameFromShahoFolder('0001_株式会社A_山田太郎_資格取得_公文書_1')).toBeNull();
  });
});

describe('extractRoudouHokenKoubunshoInfo — [労保]年度更新 抽出', () => {
  it('通常パターン (令和7年)', () => {
    const folder = '0001_株式会社A_[労保]年度更新_202507071232247301_公文書_4';
    expect(extractRoudouHokenKoubunshoInfo(folder)).toEqual({
      reiwaYear: 7,
      isKensetsu: false,
    });
  });

  it('建設パターン', () => {
    const folder = '0011_株式会社B_[労保]年度更新(建設)_202507031133539941_公文書_2';
    expect(extractRoudouHokenKoubunshoInfo(folder)).toEqual({
      reiwaYear: 7,
      isKensetsu: true,
    });
  });

  it('年度更新でないフォルダは null', () => {
    expect(extractRoudouHokenKoubunshoInfo('0001_株式会社_[労保]概算保険料申告_公文書_1')).toBeNull();
  });

  it('公文書フォルダでない場合は null', () => {
    expect(extractRoudouHokenKoubunshoInfo('0001_株式会社_[労保]年度更新_202507071232247301_コメント_1')).toBeNull();
  });
});

describe('getShahoPerPersonRenameTitle — [社保]育休/産休 公文書', () => {
  it('育児休業等申出書 → 通知書名を返す', () => {
    const folder = '0001_株式会社A_山田太郎_[社保]育児休業等申出書_公文書_1';
    expect(getShahoPerPersonRenameTitle(folder)).toBe('健康保険・厚生年金保険育児休業等取得者確認通知書');
  });

  it('産前産後休業等申出書 → 通知書名を返す', () => {
    const folder = '0002_株式会社B_鈴木花子_[社保]産前産後休業等申出書_公文書_1';
    expect(getShahoPerPersonRenameTitle(folder)).toBe('健康保険・厚生年金保険産前産後休業取得者確認通知書');
  });

  it('コメントフォルダは対象外（null）', () => {
    expect(getShahoPerPersonRenameTitle('0001_株式会社A_山田太郎_[社保]育児休業等申出書_コメント_1')).toBeNull();
  });

  it('対象外手続きは null', () => {
    expect(getShahoPerPersonRenameTitle('0001_株式会社A_山田太郎_[社保]資格取得_公文書_1')).toBeNull();
  });
});

describe('getFixedKoubunshoFilename — 会社単位の固定名リネーム', () => {
  it.each([
    ['[労保]保険関係成立届',     '労働保険関係成立届.pdf'],
    ['[労保]名称所在地変更',     '労働保険名称所在地変更届.pdf'],
    ['[労保]概算保険料申告(継続)', '労働保険概算保険料申告書.pdf'],
    ['[社保]新規適用',           '（社会保険）適用通知書.pdf'],
  ])('%s → %s', (procedureTag, expected) => {
    const folder = `0001_株式会社X_${procedureTag}_公文書_1`;
    expect(getFixedKoubunshoFilename(folder)).toBe(expected);
  });

  it('対象外手続きは null', () => {
    expect(getFixedKoubunshoFilename('0001_株式会社A_山田太郎_[社保]資格取得_公文書_1')).toBeNull();
  });

  it('コメントフォルダは対象外', () => {
    expect(getFixedKoubunshoFilename('0001_株式会社X_[社保]新規適用_コメント_1')).toBeNull();
  });
});

describe('isLegacyEraDatePrefixedPdf — 旧バージョン出力PDFの判定', () => {
  it.each([
    ['R08年01月25日_xxx.pdf',  true],
    ['R8年1月25日_xxx.pdf',     true],
    ['H30年04月_xxx.pdf',       true],
    ['S64年12月25日_xxx.pdf',   true],
  ] as const)('%s → %s', (fileName, expected) => {
    expect(isLegacyEraDatePrefixedPdf(fileName)).toBe(expected);
  });

  it('現行形式（令和n年m月）は除外対象ではない', () => {
    expect(isLegacyEraDatePrefixedPdf('令和7年9月改定_山田太郎様_xxx.pdf')).toBe(false);
  });

  it('PDF 以外は対象外', () => {
    expect(isLegacyEraDatePrefixedPdf('R08年01月_xxx.txt')).toBe(false);
  });

  it('元号略号始まりでないファイルは対象外', () => {
    expect(isLegacyEraDatePrefixedPdf('山田太郎様_xxx.pdf')).toBe(false);
  });
});

describe('applyShahoFolderNameFallbacks — 通知書名・被保険者名のフォールバック', () => {
  const emptyInfo: NamingInfo = {
    firstInsurerName: '',
    insurerCount: 0,
    allInsurers: [],
    noticeTitle: '通知書', // DataRoot で <TITLE> 無しの場合のデフォルト
  };

  describe('isApplicationCopy=false（公文書/通知書経路）', () => {
    it('[社保]資格喪失 → タイトルを「健康保険・厚生年金保険資格喪失確認通知書」に上書き', () => {
      const folderName =
        '0001_ニキ株式会社_3513312_陳 修_[社保]資格喪失届(単記)_202605080957403094_・・・';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, false);
      expect(result.noticeTitle).toBe(
        '健康保険・厚生年金保険資格喪失確認通知書'
      );
      expect(result.firstInsurerName).toBe('陳 修');
      expect(result.allInsurers).toEqual([{ name: '陳 修' }]);
      expect(result.insurerCount).toBe(1);
    });

    it('[社保]資格取得 → 「資格取得確認および標準報酬決定通知書」', () => {
      const folderName = '0001_株式会社A_2971676_鈴木花子_[社保]資格取得_公文書_1';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, false);
      expect(result.noticeTitle).toBe(
        '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書'
      );
    });

    it('[社保]新規適用（会社単位）→ 被保険者名はクリアされる', () => {
      const folderName = '0001_株式会社X_[社保]新規適用_公文書_1';
      const info: NamingInfo = {
        ...emptyInfo,
        firstInsurerName: '誰か',
        insurerCount: 1,
        allInsurers: [{ name: '誰か' }],
      };
      const result = applyShahoFolderNameFallbacks(info, folderName, false);
      expect(result.noticeTitle).toBe('（社会保険）適用通知書');
      expect(result.firstInsurerName).toBe('');
      expect(result.allInsurers).toEqual([]);
    });

    it('既存の noticeTitle が「通知書」以外なら上書きしない', () => {
      const info: NamingInfo = {
        ...emptyInfo,
        noticeTitle: '何か特殊な通知書',
      };
      const folderName = '0001_株式会社A_山田_[社保]資格喪失_公文書_1';
      const result = applyShahoFolderNameFallbacks(info, folderName, false);
      expect(result.noticeTitle).toBe('何か特殊な通知書');
    });

    it('SHAHO_TITLE_MAP に該当しないパターンは info をそのまま返す', () => {
      const folderName = '0001_株式会社A_[雇保]資格取得_公文書_1';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, false);
      expect(result).toEqual(emptyInfo);
    });
  });

  describe('isApplicationCopy=true（届出控経路: ファイル名は `届出控.pdf` に統一）', () => {
    it('[社保]資格喪失 → 被保険者名クリア＋通知書名「届出控」', () => {
      const folderName =
        '0002_ニキ株式会社_3513312_陳 修_[社保]資格喪失届(単記)_202605080957403094_・・・';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
      expect(result.firstInsurerName).toBe('');
      expect(result.insurerCount).toBe(0);
      expect(result.allInsurers).toEqual([]);
    });

    it('[社保]資格取得 → 「届出控」', () => {
      const folderName = '0002_株式会社A_2971676_鈴木花子_[社保]資格取得_公文書_1';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
      expect(result.firstInsurerName).toBe('');
    });

    it('[社保]育児休業等申出書 → 「届出控」', () => {
      const folderName = '0002_株式会社A_山田太郎_[社保]育児休業等申出書_公文書_1';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
    });

    it('[社保]新規適用 → 「届出控」（会社単位扱い）', () => {
      const folderName = '0002_株式会社X_[社保]新規適用_公文書_1';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
      expect(result.firstInsurerName).toBe('');
    });

    it('既存の被保険者名やタイトルがあっても、届出控時は全クリアして「届出控」に統一', () => {
      const info: NamingInfo = {
        firstInsurerName: '陳　修',
        insurerCount: 1,
        allInsurers: [{ name: '陳　修' }],
        noticeTitle: '何かのタイトル',
      };
      const folderName = '0002_株式会社A_陳 修_[社保]資格喪失_公文書_1';
      const result = applyShahoFolderNameFallbacks(info, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
      expect(result.firstInsurerName).toBe('');
      expect(result.allInsurers).toEqual([]);
    });

    it('[社保]賞与支払 → 「届出控」（SHAHO_TITLE_MAP 非該当パターンでも [社保] であれば対象）', () => {
      const folderName =
        '0002_株式会社三休橋地所_3031935_原 岬平_[社保]賞与支払,70歳以上被用者賞与支払_・・・';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
      expect(result.firstInsurerName).toBe('');
    });

    it('[社保]算定基礎 → 「届出控」', () => {
      const folderName =
        '0002_株式会社VALM_[社保]算定基礎,70歳以上被用者算定基礎(CSV方式)_・・・';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
    });

    it('[社保]月額変更 → 「届出控」', () => {
      const folderName = '0002_株式会社A_山田太郎_[社保]月額変更届_公文書_1';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
    });

    it('[社保]扶養異動 → 「届出控」', () => {
      const folderName = '0002_株式会社A_山田太郎_[社保]扶養異動届_公文書_1';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result.noticeTitle).toBe('届出控');
    });

    it('[社保] 以外（[雇保]/[労保]等）は isApplicationCopy=true でも素通し', () => {
      const folderName = '0002_株式会社A_[雇保]資格取得_公文書_1';
      const result = applyShahoFolderNameFallbacks(emptyInfo, folderName, true);
      expect(result).toEqual(emptyInfo);
    });
  });
});

describe('isApplicationCopyFolder — kagami本文から届出控判定', () => {
  it('「電子申請データの写し」を含む kagami → true', () => {
    const kagami = `<?xml version="1.0" encoding="UTF-8"?>
<DOC VERSION="1.0">
  <BODY>
    <TITLE>日本年金機構からのお知らせ</TITLE>
    <MAINTXT>
      <P>当機構が受理した電子申請データの写しをお返しするサービスを開始しております。</P>
    </MAINTXT>
  </BODY>
</DOC>`;
    expect(isApplicationCopyFolder(kagami)).toBe(true);
  });

  it('「申請書の写し」を含む kagami → true', () => {
    const kagami = `<DOC><MAINTXT><P>別添申請書の写しを送付いたしますので、申請内容をご確認ください。</P></MAINTXT></DOC>`;
    expect(isApplicationCopyFolder(kagami)).toBe(true);
  });

  it('公文書（通知書）の kagami → false', () => {
    const kagami = `<?xml version="1.0" encoding="UTF-8"?>
<DOC VERSION="1.0">
  <BODY>
    <MAINTXT>
      <P>電子申請された申請について処理が完了しました。通知書がありますので、添付の通知書ファイルを参照してください。</P>
    </MAINTXT>
    <APPENDIX>
      <APPTITLE>健康保険・厚生年金保険資格喪失確認通知書</APPTITLE>
      <DOCLINK REF="7120002.pdf"></DOCLINK>
    </APPENDIX>
  </BODY>
</DOC>`;
    expect(isApplicationCopyFolder(kagami)).toBe(false);
  });

  it('undefined / 空文字列 → false', () => {
    expect(isApplicationCopyFolder(undefined)).toBe(false);
    expect(isApplicationCopyFolder('')).toBe(false);
  });
});

describe('renamePdfIfNeeded — 統合リネームロジック', () => {
  describe('[労保]年度更新（ルール1: 固定名で全PDFリネーム）', () => {
    it('数字始まりPDFも、英字始まりPDFも全て統一名にリネーム', () => {
      const folder = '0001_株式会社A_[労保]年度更新_202507071232247301_公文書_4';
      expect(renamePdfIfNeeded('20250707.pdf', folder)).toBe('令和7年度_労働保険概算・確定保険料申告書.pdf');
      expect(renamePdfIfNeeded('arbitrary_name.pdf', folder)).toBe('令和7年度_労働保険概算・確定保険料申告書.pdf');
    });

    it('建設パターンは (建設) 付与', () => {
      const folder = '0011_株式会社B_[労保]年度更新(建設)_202507031133539941_公文書_2';
      expect(renamePdfIfNeeded('any.pdf', folder)).toBe('令和7年度_労働保険概算・確定保険料申告書(建設).pdf');
    });
  });

  describe('[労保]/[社保] 固定名マッピング（ルール2）', () => {
    it('[労保]保険関係成立届 → 労働保険関係成立届.pdf', () => {
      const folder = '0001_株式会社X_[労保]保険関係成立届_公文書_1';
      expect(renamePdfIfNeeded('anything.pdf', folder)).toBe('労働保険関係成立届.pdf');
    });

    it('[社保]新規適用 → （社会保険）適用通知書.pdf', () => {
      const folder = '0001_株式会社X_[社保]新規適用_公文書_1';
      expect(renamePdfIfNeeded('7012001.pdf', folder)).toBe('（社会保険）適用通知書.pdf');
    });
  });

  describe('[社保]育休/産休（ルール3: 被保険者名様_固定名）', () => {
    it('育休 → {名前}様_…育児休業等取得者確認通知書.pdf', () => {
      const folder = '0001_株式会社A_山田太郎_[社保]育児休業等申出書_公文書_1';
      expect(renamePdfIfNeeded('any.pdf', folder)).toBe('山田太郎様_健康保険・厚生年金保険育児休業等取得者確認通知書.pdf');
    });

    it('産休 → {名前}様_…産前産後休業取得者確認通知書.pdf', () => {
      const folder = '0002_株式会社B_鈴木花子_[社保]産前産後休業等申出書_公文書_1';
      expect(renamePdfIfNeeded('any.pdf', folder)).toBe('鈴木花子様_健康保険・厚生年金保険産前産後休業取得者確認通知書.pdf');
    });
  });

  describe('[雇保]系（ルール4: 数字プレフィックス置換）', () => {
    it('資格喪失 → 数字プレフィックスを {名前}様_ に置換', () => {
      const folder = '0013_株式会社1SEC_川村夏菜_[雇保]資格喪失(離職票交付あり)_公文書_1';
      expect(renamePdfIfNeeded('2501793096_雇用保険被保険者資格喪失確認通知書.pdf', folder))
        .toBe('川村夏菜様_雇用保険被保険者資格喪失確認通知書.pdf');
    });

    it('ハイフン区切りの連番にも対応', () => {
      const folder = '0001_株式会社A_2971676_鈴木花子_[雇保]育児休業出生後休業給付_公文書_1';
      expect(renamePdfIfNeeded('202602021152166333-0001_出生後休業給付支給決定通知書.pdf', folder))
        .toBe('鈴木花子様_出生後休業給付支給決定通知書.pdf');
    });

    it('数字で始まらない既存PDFはリネームしない', () => {
      const folder = '0013_株式会社1SEC_川村夏菜_[雇保]資格喪失_公文書_1';
      expect(renamePdfIfNeeded('既存のPDF.pdf', folder)).toBe('既存のPDF.pdf');
    });
  });

  describe('リネーム対象外', () => {
    it('PDF 以外は素通し', () => {
      expect(renamePdfIfNeeded('readme.txt', '0001_株式会社A_山田太郎_[社保]育児休業等申出書_公文書_1'))
        .toBe('readme.txt');
    });

    it('社会保険の通常手続き（資格取得など）の既存PDFはそのまま返る (ルール非該当)', () => {
      const folder = '0001_株式会社A_山田太郎_[社保]資格取得_公文書_1';
      // ルール4 のフォールバック条件にもマッチしない（[雇保] でないため）
      expect(renamePdfIfNeeded('既存ファイル.pdf', folder)).toBe('既存ファイル.pdf');
    });
  });
});
