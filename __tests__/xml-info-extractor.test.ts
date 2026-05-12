import { describe, it, expect } from 'vitest';
import {
  extractNoticeTitle,
  extractFromSocialInsurance,
  extractFromEmploymentInsurance,
  extractNamingInfo,
} from '@/lib/xml-info-extractor';

const wrapN = (rootTag: string, body = '') => `<?xml version="1.0"?><${rootTag}>${body}</${rootTag}>`;

describe('extractNoticeTitle — N7xxxxxx ルートタグからの通知書名解決', () => {
  it.each([
    ['N7012001', '（社会保険）適用通知書'],
    ['N7100001', '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書'],
    ['N7120002', '健康保険・厚生年金保険資格喪失確認通知書'],
    ['N7130001', '健康保険・厚生年金保険被保険者標準報酬決定通知書'],
    ['N7140001', '健康保険・厚生年金保険被保険者標準報酬改定通知書'],
    ['N7150001', '健康保険・厚生年金保険被保険者賞与額決定通知書'],
    ['N7170003', '健康保険被扶養者（異動）決定通知書'],
    ['N7180001', '厚生年金保険70歳以上被用者該当および標準報酬月額相当額のお知らせ'],
    ['N7200001', '厚生年金保険70歳以上被用者標準報酬月額相当額決定のお知らせ'],
    ['N7210001', '厚生年金保険70歳以上被用者標準報酬月額相当額改定のお知らせ'],
    ['N7220001', '厚生年金保険70歳以上被用者標準賞与額相当額のお知らせ'],
  ] as const)('%s → "%s"', (tag, title) => {
    expect(extractNoticeTitle(wrapN(tag))).toBe(title);
  });

  it('未登録の N7xxxxxx ルートタグはデフォルト「通知書」にフォールバック', () => {
    expect(extractNoticeTitle(wrapN('N7999999'))).toBe('通知書');
  });

  it('削除済みの 7160001 は未登録なのでデフォルトの「通知書」にフォールバック', () => {
    expect(extractNoticeTitle(wrapN('N7160001'))).toBe('通知書');
  });
});

describe('extractNoticeTitle — DOC <TITLE> からの抽出', () => {
  it('<TITLE> がある → そのテキストを通知書名にする', () => {
    const xml = '<?xml version="1.0"?><DOC><TITLE>雇用保険被保険者資格取得等確認通知書</TITLE></DOC>';
    expect(extractNoticeTitle(xml)).toBe('雇用保険被保険者資格取得等確認通知書');
  });

  it('<TITLE> 末尾の「の件」は除去される', () => {
    const xml = '<?xml version="1.0"?><DOC><TITLE>雇用保険被保険者資格喪失確認通知書の件</TITLE></DOC>';
    expect(extractNoticeTitle(xml)).toBe('雇用保険被保険者資格喪失確認通知書');
  });

  it('kagami.xml で <TITLE> がなければ <APPTITLE> を使用', () => {
    const kagami = '<?xml version="1.0"?><DOC><APPTITLE>日本年金機構からのお知らせ</APPTITLE></DOC>';
    expect(extractNoticeTitle(kagami, kagami)).toBe('日本年金機構からのお知らせ');
  });

  it('<TITLE>/<APPTITLE> いずれもない → デフォルト「通知書」', () => {
    expect(extractNoticeTitle('<?xml version="1.0"?><DOC></DOC>')).toBe('通知書');
  });
});

describe('extractFromSocialInsurance — 被保険者ブロックからの名前抽出', () => {
  it('複数の <_被保険者> ブロックを全件抽出する', () => {
    const xml = `<?xml version="1.0"?><N7100001>
      <_被保険者><被保険者漢字氏名>山田太郎</被保険者漢字氏名></_被保険者>
      <_被保険者><被保険者漢字氏名>鈴木花子</被保険者漢字氏名></_被保険者>
      <_被保険者><被保険者漢字氏名>佐藤次郎</被保険者漢字氏名></_被保険者>
    </N7100001>`;
    const info = extractFromSocialInsurance(xml, '取得');
    expect(info.insurerCount).toBe(3);
    expect(info.firstInsurerName).toBe('山田太郎');
    expect(info.allInsurers?.map(i => i.name)).toEqual(['山田太郎', '鈴木花子', '佐藤次郎']);
  });

  it('70歳以上ケースでは <被用者漢字氏名> を優先抽出する', () => {
    const xml = `<?xml version="1.0"?><N7200001>
      <_被保険者><被用者漢字氏名>高橋一郎</被用者漢字氏名></_被保険者>
    </N7200001>`;
    const info = extractFromSocialInsurance(xml, '取得');
    expect(info.firstInsurerName).toBe('高橋一郎');
  });

  it('CDATA で囲まれた氏名も抽出できる', () => {
    const xml = `<?xml version="1.0"?><N7100001>
      <_被保険者><被保険者漢字氏名><![CDATA[田中 太郎]]></被保険者漢字氏名></_被保険者>
    </N7100001>`;
    const info = extractFromSocialInsurance(xml, '取得');
    expect(info.firstInsurerName).toBe('田中 太郎');
  });

  it('月額変更XMLから改定年月を抽出 (R07年09月)', () => {
    const xml = `<?xml version="1.0"?><N7140001>
      <_被保険者>
        <被保険者漢字氏名>山田太郎</被保険者漢字氏名>
        <改定年月_元号>9</改定年月_元号>
        <改定年月_年>7</改定年月_年>
        <改定年月_月>9</改定年月_月>
      </_被保険者>
    </N7140001>`;
    const info = extractFromSocialInsurance(xml, '月額変更');
    expect(info.revisionDate).toBe('R07年09月');
  });

  it('70歳以上月額変更（N7210001）は <月額改定年月_*> を使う', () => {
    const xml = `<?xml version="1.0"?><N7210001>
      <_被保険者>
        <被用者漢字氏名>高橋一郎</被用者漢字氏名>
        <月額改定年月_元号>9</月額改定年月_元号>
        <月額改定年月_年>7</月額改定年月_年>
        <月額改定年月_月>11</月額改定年月_月>
      </_被保険者>
    </N7210001>`;
    const info = extractFromSocialInsurance(xml, '月額変更');
    expect(info.revisionDate).toBe('R07年11月');
  });

  it('賞与XMLから賞与支払年月日を抽出 (R07年06月15日)', () => {
    const xml = `<?xml version="1.0"?><N7150001>
      <_被保険者><被保険者漢字氏名>山田太郎</被保険者漢字氏名></_被保険者>
      <賞与支払年月日_元号>9</賞与支払年月日_元号>
      <賞与支払年月日_年>7</賞与支払年月日_年>
      <賞与支払年月日_月>6</賞与支払年月日_月>
      <賞与支払年月日_日>15</賞与支払年月日_日>
    </N7150001>`;
    const info = extractFromSocialInsurance(xml, '賞与');
    expect(info.bonusPaymentDate).toBe('R07年06月15日');
  });

  it('適用年月を被保険者ブロックから抽出（算定基礎想定）', () => {
    const xml = `<?xml version="1.0"?><N7130001>
      <_被保険者>
        <被保険者漢字氏名>山田太郎</被保険者漢字氏名>
        <適用年月_元号>9</適用年月_元号>
        <適用年月_年>7</適用年月_年>
        <適用年月_月>9</適用年月_月>
      </_被保険者>
    </N7130001>`;
    const info = extractFromSocialInsurance(xml, '取得');
    expect(info.applicableDate).toBe('R07年09月');
  });
});

describe('extractFromEmploymentInsurance — DOC <NAME> 抽出', () => {
  it('<NAME> から宛先氏名を抽出', () => {
    const xml = '<?xml version="1.0"?><DOC><NAME>川村夏菜</NAME></DOC>';
    const info = extractFromEmploymentInsurance(xml);
    expect(info.firstInsurerName).toBe('川村夏菜');
  });
});

describe('extractNamingInfo — 統合呼び出し', () => {
  it('N-format で通知書名と被保険者名がまとめて返る', () => {
    const xml = `<?xml version="1.0"?><N7100001>
      <_被保険者><被保険者漢字氏名>山田太郎</被保険者漢字氏名></_被保険者>
    </N7100001>`;
    const info = extractNamingInfo(xml, '取得');
    expect(info.noticeTitle).toBe('健康保険・厚生年金保険資格取得確認および標準報酬決定通知書');
    expect(info.firstInsurerName).toBe('山田太郎');
    expect(info.insurerCount).toBe(1);
  });
});
