/**
 * 単体テスト: XML情報抽出ロジック
 * 社会保険取得通知書（N7100001）のパターンをテスト
 */

import { describe, it, expect } from 'vitest';
import {
  extractNamingInfo,
  extractFromSocialInsurance,
  extractNoticeTitle,
} from './extractor';

describe('extractFromSocialInsurance', () => {
  describe('N7100001 (資格取得確認通知書)', () => {
    it('被保険者が1名の場合、正しく抽出できる', () => {
      const xmlContent = `
        <N7100001>
          <_被保険者>
            <被保険者氏名>田名網　亜衣子</被保険者氏名>
            <被保険者番号>12345678</被保険者番号>
          </_被保険者>
        </N7100001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '取得');

      expect(result.insurerCount).toBe(1);
      expect(result.firstInsurerName).toBe('田名網　亜衣子');
      expect(result.allInsurers).toHaveLength(1);
      expect(result.allInsurers![0]).toEqual({
        name: '田名網　亜衣子',
        insurerNumber: '12345678',
      });
    });

    it('被保険者が複数名の場合、全員を抽出できる', () => {
      const xmlContent = `
        <N7100001>
          <_被保険者>
            <被保険者氏名>山田　太郎</被保険者氏名>
            <被保険者番号>11111111</被保険者番号>
          </_被保険者>
          <_被保険者>
            <被保険者氏名>鈴木　花子</被保険者氏名>
            <被保険者番号>22222222</被保険者番号>
          </_被保険者>
          <_被保険者>
            <被保険者氏名>佐藤　次郎</被保険者氏名>
            <被保険者番号>33333333</被保険者番号>
          </_被保険者>
        </N7100001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '取得');

      expect(result.insurerCount).toBe(3);
      expect(result.firstInsurerName).toBe('山田　太郎');
      expect(result.allInsurers).toHaveLength(3);
      expect(result.allInsurers![0].name).toBe('山田　太郎');
      expect(result.allInsurers![1].name).toBe('鈴木　花子');
      expect(result.allInsurers![2].name).toBe('佐藤　次郎');
    });

    it('CDATA形式の被保険者名も正しく抽出できる', () => {
      const xmlContent = `
        <N7100001>
          <_被保険者>
            <被保険者氏名><![CDATA[田中　一郎]]></被保険者氏名>
            <被保険者番号>99999999</被保険者番号>
          </_被保険者>
        </N7100001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '取得');

      expect(result.firstInsurerName).toBe('田中　一郎');
      expect(result.allInsurers![0].name).toBe('田中　一郎');
    });
  });

  describe('N7200001 (70歳以上被用者通知書)', () => {
    it('被用者漢字氏名を使用して抽出できる', () => {
      const xmlContent = `
        <N7200001>
          <_被保険者>
            <被用者漢字氏名>高齢　太郎</被用者漢字氏名>
            <被保険者番号>77777777</被保険者番号>
          </_被保険者>
        </N7200001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '取得');

      expect(result.firstInsurerName).toBe('高齢　太郎');
      expect(result.allInsurers![0].name).toBe('高齢　太郎');
    });
  });

  describe('N7140001 (標準報酬改定通知書)', () => {
    it('改定年月を正しく抽出できる', () => {
      const xmlContent = `
        <N7140001>
          <_被保険者>
            <被保険者氏名>改定　太郎</被保険者氏名>
            <改定年月_元号>9</改定年月_元号>
            <改定年月_年>7</改定年月_年>
            <改定年月_月>9</改定年月_月>
          </_被保険者>
        </N7140001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '月額変更');

      expect(result.revisionDate).toBe('R07年09月');
    });

    it('複数の被保険者がいても最初の改定年月を使用する', () => {
      const xmlContent = `
        <N7140001>
          <_被保険者>
            <被保険者氏名>改定　太郎</被保険者氏名>
            <改定年月_元号>9</改定年月_元号>
            <改定年月_年>7</改定年月_年>
            <改定年月_月>11</改定年月_月>
          </_被保険者>
          <_被保険者>
            <被保険者氏名>改定　花子</被保険者氏名>
            <改定年月_元号>9</改定年月_元号>
            <改定年月_年>7</改定年月_年>
            <改定年月_月>11</改定年月_月>
          </_被保険者>
        </N7140001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '月額変更');

      expect(result.revisionDate).toBe('R07年11月');
      expect(result.insurerCount).toBe(2);
    });
  });

  describe('N7210001 (70歳以上被用者月額改定通知)', () => {
    it('月額改定年月を正しく抽出できる', () => {
      const xmlContent = `
        <N7210001>
          <_被保険者>
            <被用者漢字氏名>高齢　改定</被用者漢字氏名>
            <月額改定年月_元号>9</月額改定年月_元号>
            <月額改定年月_年>  7</月額改定年月_年>
            <月額改定年月_月>11</月額改定年月_月>
          </_被保険者>
        </N7210001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '月額変更');

      expect(result.revisionDate).toBe('R07年11月');
      expect(result.firstInsurerName).toBe('高齢　改定');
    });
  });

  describe('エッジケース', () => {
    it('被保険者ブロックがない場合、従来の方法で抽出を試みる', () => {
      const xmlContent = `
        <N7100001>
          <被保険者氏名>従来　太郎</被保険者氏名>
        </N7100001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '取得');

      expect(result.firstInsurerName).toBe('従来　太郎');
      expect(result.insurerCount).toBe(1);
      expect(result.allInsurers).toHaveLength(1);
    });

    it('被保険者情報が全くない場合、空の結果を返す', () => {
      const xmlContent = `
        <N7100001>
          <その他の情報>test</その他の情報>
        </N7100001>
      `;

      const result = extractFromSocialInsurance(xmlContent, '取得');

      expect(result.insurerCount).toBe(0);
      expect(result.firstInsurerName).toBeUndefined();
      expect(result.allInsurers).toHaveLength(0);
    });
  });
});

describe('extractNoticeTitle', () => {
  it('N7100001の場合、正しい通知書名を返す', () => {
    const xmlContent = '<N7100001>...</N7100001>';
    const result = extractNoticeTitle(xmlContent);
    expect(result).toBe('健康保険・厚生年金保険資格取得確認および標準報酬決定通知書');
  });

  it('N7130001の場合、正しい通知書名を返す', () => {
    const xmlContent = '<N7130001>...</N7130001>';
    const result = extractNoticeTitle(xmlContent);
    expect(result).toBe('健康保険・厚生年金保険被保険者標準報酬決定通知書');
  });

  it('N7140001の場合、正しい通知書名を返す', () => {
    const xmlContent = '<N7140001>...</N7140001>';
    const result = extractNoticeTitle(xmlContent);
    expect(result).toBe('健康保険・厚生年金保険標準報酬改定通知書');
  });

  it('N7200001の場合、正しい通知書名を返す', () => {
    const xmlContent = '<N7200001>...</N7200001>';
    const result = extractNoticeTitle(xmlContent);
    expect(result).toBe('厚生年金保険70歳以上被用者該当および標準報酬月額相当額のお知らせ');
  });

  it('N7210001の場合、正しい通知書名を返す', () => {
    const xmlContent = '<N7210001>...</N7210001>';
    const result = extractNoticeTitle(xmlContent);
    expect(result).toBe('厚生年金保険70歳以上被用者標準報酬月額相当額改定のお知らせ');
  });

  it('DOC形式の場合、TITLEタグから抽出する', () => {
    const xmlContent = '<DOC><TITLE>返戻のお知らせの件</TITLE></DOC>';
    const result = extractNoticeTitle(xmlContent);
    expect(result).toBe('返戻のお知らせ'); // 「の件」が除去される
  });

  it('不明な形式の場合、デフォルトで「通知書」を返す', () => {
    const xmlContent = '<UNKNOWN>...</UNKNOWN>';
    const result = extractNoticeTitle(xmlContent);
    expect(result).toBe('通知書');
  });
});

describe('extractNamingInfo', () => {
  it('N7100001形式のXMLから完全な命名情報を抽出できる', () => {
    const xmlContent = `
      <N7100001>
        <_被保険者>
          <被保険者氏名>田名網　亜衣子</被保険者氏名>
          <被保険者番号>12345678</被保険者番号>
        </_被保険者>
      </N7100001>
    `;

    const result = extractNamingInfo(xmlContent, '取得');

    expect(result.noticeTitle).toBe('健康保険・厚生年金保険資格取得確認および標準報酬決定通知書');
    expect(result.firstInsurerName).toBe('田名網　亜衣子');
    expect(result.insurerCount).toBe(1);
    expect(result.allInsurers).toHaveLength(1);
    expect(result.allInsurers![0].name).toBe('田名網　亜衣子');
  });

  it('複数名のN7100001形式XMLから完全な命名情報を抽出できる', () => {
    const xmlContent = `
      <N7100001>
        <_被保険者>
          <被保険者氏名>山田　太郎</被保険者氏名>
        </_被保険者>
        <_被保険者>
          <被保険者氏名>鈴木　花子</被保険者氏名>
        </_被保険者>
      </N7100001>
    `;

    const result = extractNamingInfo(xmlContent, '取得');

    expect(result.insurerCount).toBe(2);
    expect(result.firstInsurerName).toBe('山田　太郎');
    expect(result.allInsurers).toHaveLength(2);
  });

  it('N7140001形式のXMLから改定年月を含む命名情報を抽出できる', () => {
    const xmlContent = `
      <N7140001>
        <_被保険者>
          <被保険者氏名>改定　太郎</被保険者氏名>
          <改定年月_元号>9</改定年月_元号>
          <改定年月_年>7</改定年月_年>
          <改定年月_月>9</改定年月_月>
        </_被保険者>
        <_被保険者>
          <被保険者氏名>改定　花子</被保険者氏名>
          <改定年月_元号>9</改定年月_元号>
          <改定年月_年>7</改定年月_年>
          <改定年月_月>9</改定年月_月>
        </_被保険者>
      </N7140001>
    `;

    const result = extractNamingInfo(xmlContent, '月額変更');

    expect(result.noticeTitle).toBe('健康保険・厚生年金保険標準報酬改定通知書');
    expect(result.revisionDate).toBe('R07年09月');
    expect(result.insurerCount).toBe(2);
  });

  it('N7210001形式のXMLから月額改定年月を含む命名情報を抽出できる', () => {
    const xmlContent = `
      <N7210001>
        <_被保険者>
          <被用者漢字氏名>高齢　改定</被用者漢字氏名>
          <月額改定年月_元号>9</月額改定年月_元号>
          <月額改定年月_年>  7</月額改定年月_年>
          <月額改定年月_月>11</月額改定年月_月>
        </_被保険者>
      </N7210001>
    `;

    const result = extractNamingInfo(xmlContent, '月額変更');

    expect(result.noticeTitle).toBe('厚生年金保険70歳以上被用者標準報酬月額相当額改定のお知らせ');
    expect(result.revisionDate).toBe('R07年11月');
    expect(result.firstInsurerName).toBe('高齢　改定');
  });
});
