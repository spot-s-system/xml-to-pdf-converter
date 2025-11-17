/**
 * 統合テスト: 実際のサンプルファイルを使用したテスト
 * 社会保険取得.zipの実際のデータで、正しく処理できることを確認
 */

import { describe, it, expect } from 'vitest';
import { detectProcedureType } from '../config/document-types';
import { extractNamingInfo } from '../xml/extractor';
import { generateIndividualPdfFileName, generatePdfFileName } from '../pdf/naming';

// 実際の7100001.xmlのサンプルデータ（社会保険取得.zipより抽出）
const REAL_7100001_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="7100001.xsl"?>
<N7100001>
	<_被保険者>
		<通知管理番号>202502424764415</通知管理番号>
		<通知管理番号枝番>00001</通知管理番号枝番>
		<通知年月日><![CDATA[令和 7年11月 4日]]></通知年月日>
		<事業所整理記号_郡市区記号>31</事業所整理記号_郡市区記号>
		<事業所整理記号_事業所記号>ﾊﾍｱ </事業所整理記号_事業所記号>
		<事業所番号>02881</事業所番号>
		<被保険者整理番号>   407</被保険者整理番号>
		<被保険者カナ氏名>ﾀﾅｱﾐ ｱｲｺ                 </被保険者カナ氏名>
		<被保険者漢字氏名><![CDATA[田名網　亜衣子]]></被保険者漢字氏名>
		<資格取得年月日_元号>R</資格取得年月日_元号>
		<資格取得年月日_年>07</資格取得年月日_年>
		<資格取得年月日_月>11</資格取得年月日_月>
		<資格取得年月日_日>01</資格取得年月日_日>
		<標準報酬月額_健保> 530千円</標準報酬月額_健保>
		<標準報酬月額_厚年> 530千円</標準報酬月額_厚年>
		<生年月日_元号>S</生年月日_元号>
		<生年月日_年>42</生年月日_年>
		<生年月日_月>10</生年月日_月>
		<生年月日_日>21</生年月日_日>
		<種別_性別>2（女）　</種別_性別>
		<取得区分>2（再）</取得区分>
		<基礎年金番号_上4桁>1160</基礎年金番号_上4桁>
		<基礎年金番号_下6桁>473071</基礎年金番号_下6桁>
		<年金事務所名><![CDATA[横浜中年金事務所]]></年金事務所名>
	</_被保険者>
</N7100001>`;

describe('統合テスト: 実際のサンプルデータを使用', () => {
  describe('社会保険取得.zip - 7100001.xml（資格取得確認通知書）', () => {
    it('手続き種別を正しく判定できる', () => {
      const result = detectProcedureType(REAL_7100001_XML);

      expect(result.type).toBe('取得');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('被保険者情報を正しく抽出できる', () => {
      const result = extractNamingInfo(REAL_7100001_XML, '取得');

      // 被保険者名の確認
      expect(result.firstInsurerName).toBe('田名網　亜衣子');
      expect(result.insurerCount).toBe(1);
      expect(result.allInsurers).toHaveLength(1);
      expect(result.allInsurers![0].name).toBe('田名網　亜衣子');

      // 通知書名の確認
      expect(result.noticeTitle).toBe('健康保険・厚生年金保険資格取得確認および標準報酬決定通知書');
    });

    it('個別PDFファイル名を正しく生成できる', () => {
      const filename = generateIndividualPdfFileName(
        '取得',
        '田名網　亜衣子',
        '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書'
      );

      // 期待されるファイル名: 「田名網　亜衣子様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf」
      // ただし、sanitizeFileNameが連続する空白を1つにまとめるため、全角スペースも半角に変換される
      expect(filename).toContain('田名網');
      expect(filename).toContain('亜衣子様_');
      expect(filename).toContain('健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
    });

    it('NamingInfoを使用した完全なPDFファイル名を生成できる', () => {
      const namingInfo = extractNamingInfo(REAL_7100001_XML, '取得');
      const filename = generatePdfFileName('取得', namingInfo);

      // 被保険者が1名なので「被保険者名様_通知書名.pdf」形式
      expect(filename).toContain('田名網');
      expect(filename).toContain('亜衣子様_');
      expect(filename).toContain('健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
    });
  });

  describe('エンドツーエンド: XMLからPDFファイル名生成までの流れ', () => {
    it('実際のXMLデータから正しいファイル名を生成する', () => {
      // ステップ1: 手続き種別を判定
      const procedureInfo = detectProcedureType(REAL_7100001_XML);
      expect(procedureInfo.type).toBe('取得');
      expect(procedureInfo.pdfStrategy).toBe('individual');

      // ステップ2: 命名情報を抽出
      const namingInfo = extractNamingInfo(REAL_7100001_XML, procedureInfo.type);
      expect(namingInfo.insurerCount).toBe(1);
      expect(namingInfo.firstInsurerName).toBe('田名網　亜衣子');

      // ステップ3: 個別PDF戦略の場合、個別PDFファイル名を生成
      if (procedureInfo.pdfStrategy === 'individual' && namingInfo.allInsurers && namingInfo.allInsurers.length >= 1) {
        const person = namingInfo.allInsurers[0];
        const filename = generateIndividualPdfFileName(
          procedureInfo.type,
          person.name,
          namingInfo.noticeTitle
        );

        // 個別PDFファイル名が「様」を含むことを確認
        expect(filename).toContain('様_');
        expect(filename).toContain('健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf');
      } else {
        throw new Error('Expected individual PDF strategy with at least 1 insurer');
      }
    });

    it('複数被保険者のXMLデータから正しいファイル名を生成する（想定）', () => {
      // 複数被保険者のサンプルXML
      const multiPersonXml = `
        <N7100001>
          <_被保険者>
            <被保険者漢字氏名><![CDATA[山田　太郎]]></被保険者漢字氏名>
          </_被保険者>
          <_被保険者>
            <被保険者漢字氏名><![CDATA[鈴木　花子]]></被保険者漢字氏名>
          </_被保険者>
        </N7100001>
      `;

      const procedureInfo = detectProcedureType(multiPersonXml);
      const namingInfo = extractNamingInfo(multiPersonXml, procedureInfo.type);

      expect(namingInfo.insurerCount).toBe(2);
      expect(procedureInfo.pdfStrategy).toBe('individual');

      // 各被保険者ごとに個別PDFが生成されるべき
      if (namingInfo.allInsurers) {
        const filenames = namingInfo.allInsurers.map(person =>
          generateIndividualPdfFileName(procedureInfo.type, person.name, namingInfo.noticeTitle)
        );

        expect(filenames).toHaveLength(2);
        expect(filenames[0]).toContain('山田');
        expect(filenames[0]).toContain('太郎様_');
        expect(filenames[1]).toContain('鈴木');
        expect(filenames[1]).toContain('花子様_');
      }
    });
  });

  describe('特殊文字を含む名前の処理', () => {
    it('全角スペースを含む名前を正しく処理する', () => {
      const xmlWithFullWidthSpace = `
        <N7100001>
          <_被保険者>
            <被保険者漢字氏名><![CDATA[田名網　亜衣子]]></被保険者漢字氏名>
          </_被保険者>
        </N7100001>
      `;

      const namingInfo = extractNamingInfo(xmlWithFullWidthSpace, '取得');

      // 抽出段階では全角スペースが保持される
      expect(namingInfo.firstInsurerName).toBe('田名網　亜衣子');

      // ファイル名生成時にサニタイズされる
      const filename = generateIndividualPdfFileName(
        '取得',
        namingInfo.firstInsurerName!,
        namingInfo.noticeTitle
      );

      // サニタイズ後は連続する空白が1つにまとめられる
      expect(filename).toMatch(/田名網.*亜衣子様_/);
    });

    it('CDATA形式の名前を正しく抽出する', () => {
      const xmlWithCdata = `
        <N7100001>
          <_被保険者>
            <被保険者漢字氏名><![CDATA[佐藤　一郎]]></被保険者漢字氏名>
          </_被保険者>
        </N7100001>
      `;

      const namingInfo = extractNamingInfo(xmlWithCdata, '取得');
      expect(namingInfo.firstInsurerName).toBe('佐藤　一郎');
    });
  });

  describe('エッジケース', () => {
    it('不正な形式のXMLでもエラーにならない', () => {
      const invalidXml = '<INVALID>test</INVALID>';

      expect(() => {
        detectProcedureType(invalidXml);
      }).not.toThrow();

      expect(() => {
        extractNamingInfo(invalidXml, 'その他');
      }).not.toThrow();
    });

    it('被保険者ブロックがないXMLでもエラーにならない', () => {
      const noInsurerXml = `<N7100001><その他の情報>test</その他の情報></N7100001>`;

      const namingInfo = extractNamingInfo(noInsurerXml, '取得');
      // 被保険者ブロックがない場合、従来の方法で抽出を試みるが見つからない
      expect(namingInfo.insurerCount).toBe(0);
      expect(namingInfo.allInsurers).toHaveLength(0);
    });
  });
});
