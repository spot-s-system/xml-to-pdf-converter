import { describe, it, expect } from 'vitest';
import {
  detectProcedureType,
  detectProcedureTypeFromFileName,
} from '@/lib/procedure-detector';

const wrap = (rootTag: string, body = '') => `<?xml version="1.0"?><${rootTag}>${body}</${rootTag}>`;

describe('detectProcedureType — N7xxxxxx 社会保険フォーマット', () => {
  it.each([
    // [rootTag,       expectedType, expectedStrategy]
    ['N7012001', 'その他',  'combined'],   // 新規適用（会社単位）
    ['N7100001', '取得',    'individual'], // 資格取得
    ['N7120002', '喪失',    'individual'], // 資格喪失
    ['N7130001', '取得',    'individual'], // 算定基礎
    ['N7140001', '月額変更', 'combined'],   // 月額変更
    ['N7150001', '賞与',    'combined'],   // 賞与支払届
    ['N7170003', '取得',    'individual'], // 扶養異動
    ['N7180001', '取得',    'individual'], // 70歳以上 資格取得
    ['N7200001', '取得',    'individual'], // 70歳以上 算定基礎
    ['N7210001', '月額変更', 'combined'],   // 70歳以上 月額変更
    ['N7220001', '賞与',    'combined'],   // 70歳以上 賞与
  ] as const)('%s → type=%s, strategy=%s', (tag, type, strategy) => {
    const info = detectProcedureType(wrap(tag));
    expect(info.type).toBe(type);
    expect(info.category).toBe('社会保険');
    expect(info.pdfStrategy).toBe(strategy);
  });

  it('登録されていない N7xxxxx は社会保険 / その他 / combined にフォールバックしない（不明扱い）', () => {
    // ルート判定では未登録なので socialInsurancePatterns ヒットせず、
    // DataRoot/DOC でもないので「その他 / 不明 / combined」になる。
    const info = detectProcedureType(wrap('N7999999'));
    expect(info.category).toBe('不明');
    expect(info.type).toBe('その他');
    expect(info.pdfStrategy).toBe('combined');
  });

  it('7160001 は存在しない番号であり、登録されていない', () => {
    // 過去にコード上に存在していたが、実体のない番号として削除済み。
    // ルート N7160001 を渡しても 社会保険として個別認識されないことを担保。
    const info = detectProcedureType(wrap('N7160001'));
    expect(info.category).not.toBe('社会保険');
  });
});

describe('detectProcedureType — DataRoot（電子申請）', () => {
  const buildDataRoot = (formId: string) =>
    `<?xml version="1.0"?><DataRoot><様式ID>${formId}</様式ID></DataRoot>`;

  it('様式ID に 30839 を含む → 社会保険 / 取得 / individual', () => {
    const info = detectProcedureType(buildDataRoot('30839'));
    expect(info.category).toBe('社会保険');
    expect(info.type).toBe('取得');
    expect(info.pdfStrategy).toBe('individual');
  });

  it('様式ID に 30840 を含む → 社会保険 / 喪失 / individual', () => {
    const info = detectProcedureType(buildDataRoot('30840'));
    expect(info.category).toBe('社会保険');
    expect(info.type).toBe('喪失');
    expect(info.pdfStrategy).toBe('individual');
  });

  it('様式ID に 30841 を含む → 社会保険 / 取得 / individual', () => {
    const info = detectProcedureType(buildDataRoot('30841'));
    expect(info.category).toBe('社会保険');
    expect(info.type).toBe('取得');
  });

  it('様式ID 部分文字列にマッチする ("...30839...") も同じく判定される', () => {
    // 実データは先頭・末尾に追加の桁が付くケースがあるため
    const info = detectProcedureType(buildDataRoot('1234308399999'));
    expect(info.type).toBe('取得');
  });

  it('DataRoot だが 様式ID が未登録 → 社会保険 / その他 / combined', () => {
    const info = detectProcedureType(buildDataRoot('99999999'));
    expect(info.category).toBe('社会保険');
    expect(info.type).toBe('その他');
    expect(info.pdfStrategy).toBe('combined');
  });

  it('DataRoot で 様式ID 自体が無い → 社会保険 / その他 / combined', () => {
    const info = detectProcedureType('<?xml version="1.0"?><DataRoot></DataRoot>');
    expect(info.category).toBe('社会保険');
    expect(info.type).toBe('その他');
  });
});

describe('detectProcedureType — DOC（雇用保険）', () => {
  const buildDoc = (title: string) =>
    `<?xml version="1.0"?><DOC><TITLE>${title}</TITLE></DOC>`;

  it('TITLE に 資格取得 → 雇用保険 / 取得 / individual', () => {
    const info = detectProcedureType(buildDoc('雇用保険被保険者資格取得等確認通知書'));
    expect(info.category).toBe('雇用保険');
    expect(info.type).toBe('取得');
    expect(info.pdfStrategy).toBe('individual');
  });

  it('TITLE に 資格喪失 → 雇用保険 / 喪失 / individual', () => {
    const info = detectProcedureType(buildDoc('雇用保険被保険者資格喪失確認通知書'));
    expect(info.category).toBe('雇用保険');
    expect(info.type).toBe('喪失');
    expect(info.pdfStrategy).toBe('individual');
  });

  it('TITLE が認識外 → 雇用保険 / その他 / combined', () => {
    const info = detectProcedureType(buildDoc('教育訓練給付金支給決定通知書'));
    expect(info.category).toBe('雇用保険');
    expect(info.type).toBe('その他');
    expect(info.pdfStrategy).toBe('combined');
  });
});

describe('detectProcedureType — フォールバック', () => {
  it('ルートタグが全く取れない場合 → その他 / 不明', () => {
    const info = detectProcedureType('plain text without xml');
    expect(info.category).toBe('不明');
    expect(info.type).toBe('その他');
  });
});

describe('detectProcedureTypeFromFileName — ファイル名フォールバック', () => {
  it.each([
    ['月額変更届_xxx.xml', '社会保険', '月額変更'],
    ['算定基礎届_xxx.xml', '社会保険', '算定基礎届'],
    ['賞与支払届_xxx.xml', '社会保険', '賞与'],
    ['資格取得_xxx.xml',  '社会保険', '取得'],
    ['資格喪失_xxx.xml',  '社会保険', '喪失'],
    ['[雇保]資格取得_xxx.xml', '雇用保険', '取得'],
    ['[雇保]資格喪失_xxx.xml', '雇用保険', '喪失'],
    ['その他_xxx.xml',    '不明',     'その他'],
  ] as const)('%s → category=%s, type=%s', (name, category, type) => {
    const info = detectProcedureTypeFromFileName(name);
    expect(info.category).toBe(category);
    expect(info.type).toBe(type);
  });
});
