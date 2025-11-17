/**
 * 単体テスト: 手続き種別判定ロジック
 * 社会保険各種通知書の判定とPDF生成戦略をテスト
 */

import { describe, it, expect } from 'vitest';
import { detectProcedureType } from './document-types';

describe('detectProcedureType', () => {
  describe('N7xxxxxx系（社会保険フォーマット）', () => {
    it('N7100001 (資格取得確認通知書) を正しく判定する', () => {
      const xmlContent = '<N7100001>...</N7100001>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('取得');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('N7130001 (標準報酬決定通知書) を正しく判定する', () => {
      const xmlContent = '<N7130001>...</N7130001>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('取得');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('N7140001 (標準報酬改定通知書) を正しく判定する', () => {
      const xmlContent = '<N7140001>...</N7140001>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('月額変更');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('combined');
    });

    it('N7200001 (70歳以上被用者通知書) を正しく判定する', () => {
      const xmlContent = '<N7200001>...</N7200001>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('取得');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('N7210001 (70歳以上被用者月額改定通知) を正しく判定する', () => {
      const xmlContent = '<N7210001>...</N7210001>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('月額変更');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('combined');
    });

    it('N7150001 (算定基礎届) を正しく判定する', () => {
      const xmlContent = '<N7150001>...</N7150001>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('算定基礎届');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('combined');
    });

    it('N7160001 (賞与支払届) を正しく判定する', () => {
      const xmlContent = '<N7160001>...</N7160001>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('賞与');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('combined');
    });

    it('N7170003 (被扶養者異動届) を正しく判定する', () => {
      const xmlContent = '<N7170003>...</N7170003>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('取得');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('individual');
    });
  });

  describe('DataRoot形式（社会保険電子申請）', () => {
    it('様式ID 30839 (取得) を正しく判定する', () => {
      const xmlContent = '<DataRoot><様式ID>30839</様式ID></DataRoot>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('取得');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('様式ID 30840 (喪失) を正しく判定する', () => {
      const xmlContent = '<DataRoot><様式ID>30840</様式ID></DataRoot>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('喪失');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('様式ID 30841 (取得) を正しく判定する', () => {
      const xmlContent = '<DataRoot><様式ID>30841</様式ID></DataRoot>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('取得');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('不明な様式IDの場合はその他として判定する', () => {
      const xmlContent = '<DataRoot><様式ID>99999</様式ID></DataRoot>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('その他');
      expect(result.category).toBe('社会保険');
      expect(result.pdfStrategy).toBe('combined');
    });
  });

  describe('DOC形式（雇用保険）', () => {
    it('TITLEに「資格取得」を含む場合、取得として判定する', () => {
      const xmlContent = '<DOC><TITLE>雇用保険被保険者資格取得確認通知書</TITLE></DOC>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('取得');
      expect(result.category).toBe('雇用保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('TITLEに「資格喪失」を含む場合、喪失として判定する', () => {
      const xmlContent = '<DOC><TITLE>雇用保険被保険者資格喪失確認通知書</TITLE></DOC>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('喪失');
      expect(result.category).toBe('雇用保険');
      expect(result.pdfStrategy).toBe('individual');
    });

    it('TITLEが取得・喪失でない場合、その他として判定する', () => {
      const xmlContent = '<DOC><TITLE>返戻のお知らせ</TITLE></DOC>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('その他');
      expect(result.category).toBe('雇用保険');
      expect(result.pdfStrategy).toBe('combined');
    });
  });

  describe('エッジケース', () => {
    it('不明なルートタグの場合、その他として判定する', () => {
      const xmlContent = '<UNKNOWN>...</UNKNOWN>';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('その他');
      expect(result.category).toBe('不明');
      expect(result.pdfStrategy).toBe('combined');
    });

    it('ルートタグがない場合、その他として判定する', () => {
      const xmlContent = 'invalid xml';
      const result = detectProcedureType(xmlContent);

      expect(result.type).toBe('その他');
      expect(result.category).toBe('不明');
      expect(result.pdfStrategy).toBe('combined');
    });
  });

  describe('PDF生成戦略', () => {
    it('取得・喪失は individual 戦略になる', () => {
      const testCases = [
        '<N7100001>...</N7100001>',
        '<N7130001>...</N7130001>',
        '<N7200001>...</N7200001>',
        '<N7170003>...</N7170003>',
        '<DataRoot><様式ID>30839</様式ID></DataRoot>',
        '<DataRoot><様式ID>30840</様式ID></DataRoot>',
        '<DOC><TITLE>雇用保険被保険者資格取得確認通知書</TITLE></DOC>',
        '<DOC><TITLE>雇用保険被保険者資格喪失確認通知書</TITLE></DOC>',
      ];

      testCases.forEach((xmlContent) => {
        const result = detectProcedureType(xmlContent);
        expect(result.pdfStrategy).toBe('individual');
      });
    });

    it('月額変更・算定基礎届・賞与・その他は combined 戦略になる', () => {
      const testCases = [
        '<N7140001>...</N7140001>',
        '<N7210001>...</N7210001>',
        '<N7150001>...</N7150001>',
        '<N7160001>...</N7160001>',
        '<DataRoot><様式ID>99999</様式ID></DataRoot>',
        '<DOC><TITLE>返戻のお知らせ</TITLE></DOC>',
        '<UNKNOWN>...</UNKNOWN>',
      ];

      testCases.forEach((xmlContent) => {
        const result = detectProcedureType(xmlContent);
        expect(result.pdfStrategy).toBe('combined');
      });
    });
  });
});
