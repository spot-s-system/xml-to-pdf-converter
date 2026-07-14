/**
 * 育児休業終了時月額変更届（通知書ID 2050001 / ルートタグ N2050001）の
 * 通知書名・被保険者名抽出の回帰テスト。
 *
 * 特徴:
 *   - ID が 7 始まりでない（N2050001）ため、N7\d{6} 前提の判定を N\d{7} に
 *     拡張して SHAHO_NOTICE_TITLES で照合する必要がある。
 *   - XML は <_被保険者> ブロックを持たないフラット構造で、ルート直下の
 *     <被保険者氏名> に氏名が入る。
 *   - 日付タグは <改定年月x元号>（アンダースコアでなく x 区切り）なので、
 *     月額変更/算定基礎向けの日付抽出には引っかからず、命名で日付プレフィックスの
 *     元にならない（7140001 と違い被保険者単位・日付無しで命名するため）。
 *
 * ※ 氏名は架空（実在の被保険者情報は使用しない）。
 */
import { describe, it, expect } from 'vitest';
import { extractNoticeTitle, extractNamingInfo } from '@/lib/xml-info-extractor';

const GETSUGAKU_TITLE = '健康保険・厚生年金保険被保険者標準報酬改定通知書';

describe('N2050001（育児休業終了時月額変更）情報抽出', () => {
  it('extractNoticeTitle: N2050001 ルートタグから標準報酬改定通知書名を解決する', () => {
    const xml = '<?xml version="1.0"?><N2050001></N2050001>';
    expect(extractNoticeTitle(xml)).toBe(GETSUGAKU_TITLE);
  });

  it('extractNamingInfo: フラット構造のルート直下 <被保険者氏名> から氏名を拾い、日付は付けない', () => {
    const xml = `<?xml version="1.0"?><N2050001>
      <被保険者氏名><![CDATA[山田　花子]]></被保険者氏名>
      <改定年月x元号><![CDATA[R]]></改定年月x元号>
      <改定年月x年>08</改定年月x年>
      <改定年月x月>07</改定年月x月>
    </N2050001>`;
    const info = extractNamingInfo(xml, 'その他');
    expect(info.noticeTitle).toBe(GETSUGAKU_TITLE);
    expect(info.firstInsurerName).toBe('山田　花子'); // 全角スペース保持（サニタイズは命名側で実施）
    expect(info.insurerCount).toBe(1);
    // x 区切りの日付タグは拾わない → 日付プレフィックスの元にならない
    expect(info.revisionDate).toBeUndefined();
    expect(info.applicableDate).toBeUndefined();
  });
});
