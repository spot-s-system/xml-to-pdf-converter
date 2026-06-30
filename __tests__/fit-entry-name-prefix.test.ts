/**
 * fitEntryNameToShellLimit の日付・年度プレフィックス退避の回帰テスト
 *
 * 算定/月変/賞与のファイル名は氏名の前に `令和{n}年度算定_` 等のプレフィックスが付く。
 * 89文字制限超過時、プレフィックスを「氏名」と誤認して削ると氏名が丸ごと消える
 * （例: 株式会社東信の `令和7年度算定様_…`）。被保険者名は本人特定情報なので、
 * 超過時はまずプレフィックスを落として氏名・帳票名をフル保持する。
 */
import { describe, it, expect } from 'vitest';
import { fitEntryNameToShellLimit } from '../lib/bulk-zip-processor';

describe('fitEntryNameToShellLimit: 日付プレフィックスを最優先で落とす', () => {
  // 株式会社東信 0007 の実ケース（フォルダプレフィックス46字）を再現
  const folderPrefix =
    '0007_株式会社東信_1_青木 宏泰(他9名)_[社保]算定基礎,70歳以上被用者・・・/';
  const title7200001 =
    '厚生年金保険70歳以上被用者標準報酬月額相当額決定のお知らせ';

  it('算定プレフィックス付き7200001: プレフィックスを落として氏名フル保持', () => {
    const input = `令和7年度算定_中村 弘志様_${title7200001}.pdf`;
    const out = fitEntryNameToShellLimit(folderPrefix, input);
    expect(out).toBe(`中村 弘志様_${title7200001}.pdf`);
    expect(folderPrefix.length + out.length).toBeLessThanOrEqual(89);
    // 氏名が残っていること（回帰検出: `令和7年度算定様_` にならない）
    expect(out).toContain('中村 弘志様_');
    expect(out.startsWith('令和7年度算定様')).toBe(false);
  });

  it('算定プレフィックス付き7130001(連結): 氏名他N名フル保持', () => {
    const title =
      '健康保険・厚生年金保険被保険者標準報酬決定通知書';
    const input = `令和7年度算定_青木 宏泰様他8名_${title}.pdf`;
    const out = fitEntryNameToShellLimit(folderPrefix, input);
    expect(out).toBe(`青木 宏泰様他8名_${title}.pdf`);
    expect(out).toContain('青木 宏泰様他8名_');
  });

  it('月額変更の改定プレフィックスも退避対象', () => {
    const title = '健康保険・厚生年金保険被保険者標準報酬改定通知書';
    const input = `令和7年11月改定_中村 弘志様_${title}.pdf`;
    const out = fitEntryNameToShellLimit(folderPrefix, input);
    expect(out).toContain('中村 弘志様_');
    expect(out.startsWith('令和7年11月改定様')).toBe(false);
  });

  it('十分短ければプレフィックスは保持される（超過時のみ落とす）', () => {
    const shortPrefix = '0001_A_山田_[社保]算定基礎/';
    const input = '令和7年度算定_山田 太郎様_標準報酬決定通知書.pdf';
    const out = fitEntryNameToShellLimit(shortPrefix, input);
    expect(out).toBe(input); // 収まるのでそのまま
  });
});
