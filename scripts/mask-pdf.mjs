// PDFの個人情報・会社情報をマスク、会社情報と被保険者氏名はダミー値で差し替え
// 被保険者整理番号は赤枠で強調
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { promises as fs } from 'fs';

const INPUT = String.raw`C:\Users\koiwa\Downloads\公文書・コメント一括出力_取得70歳以上_20260511150326561_変換結果\0001_株式会社バリュー・エージェント_3922676_高橋 尚子_[社保]資格取・・・\高橋 尚子様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf`;
const OUTPUT = String.raw`C:\Users\koiwa\Downloads\高橋 尚子様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書_masked.pdf`;
const FONT_PATH = String.raw`C:\Windows\Fonts\NotoSansJP-VF.ttf`;

// 白塗りマスク（テキスト範囲ぴったり、罫線を保護）
const PAGE_1_MASKS = [
  { x: 67, y: 755.5, w: 31, h: 9, label: '会社郵便番号' },
  { x: 66, y: 737.5, w: 148, h: 10, label: '会社住所' },
  { x: 66, y: 710.5, w: 148, h: 11, label: '会社名' },
  { x: 66, y: 679.5, w: 50, h: 11, label: '事業主氏名' },
  { x: 159, y: 660.5, w: 120, h: 9, label: '通知管理番号' },
  { x: 449, y: 765.5, w: 72, h: 9, label: '到達番号(ヘッダ)' },
  { x: 145, y: 555.5, w: 36, h: 10, label: '事業所整理記号(値)' },
  { x: 154, y: 541.5, w: 25, h: 10, label: '事業所番号(値)' },
  { x: 104, y: 479.5, w: 33, h: 10, label: '被保険者氏名(カナ)' },
  { x: 104, y: 467.0, w: 44, h: 10, label: '被保険者氏名(漢字)' },
  { x: 280, y: 473.0, w: 63, h: 11, label: '資格取得年月日' },
  { x: 419, y: 473.0, w: 36, h: 11, label: '標準報酬月額(健保)' },
  { x: 524, y: 473.0, w: 36, h: 11, label: '標準報酬月額(厚年)' },
  { x: 99.6, y: 448.0, w: 50, h: 9, label: '生年月日' },
  { x: 154, y: 448.0, w: 23, h: 8, label: '種別(性別)' },
  { x: 202, y: 448.0, w: 22, h: 8, label: '取得区分' },
  { x: 351, y: 451.5, w: 31, h: 9, label: '郵便番号' },
  { x: 396, y: 452.5, w: 141, h: 9, label: '被保険者住所' },
  { x: 349, y: 103.8, w: 61, h: 10, label: '通知日' },
];

const PAGE_3_MASKS = [
  { x: 435, y: 780.0, w: 72, h: 9, label: '到達番号(P3)' },
  { x: 200, y: 712.5, w: 39, h: 10, label: '事業所整理記号(値)(P3)' },
  { x: 208, y: 693.5, w: 25, h: 10, label: '事業所番号(値)(P3)' },
  { x: 164, y: 678.5, w: 121, h: 9, label: '通知管理番号(P3)' },
];

// ダミー値を埋め込む対象（x, y はベースライン）
const PAGE_1_DUMMY_TEXTS = [
  { x: 67.5, y: 756.4, size: 7,  text: '123-0000',                  label: '会社郵便番号' },
  { x: 67.5, y: 738.4, size: 8,  text: '東京都千代田区千代田 1-1-1', label: '会社住所' },
  { x: 67.5, y: 711.4, size: 9,  text: '株式会社 サンプル',          label: '会社名' },
  { x: 67.5, y: 680.7, size: 9,  text: 'スポット 太郎',              label: '事業主氏名' },
  { x: 105.4, y: 481.2, size: 8, text: 'ｽﾎﾟｯﾄ ﾀﾛｳ',                 label: '被保険者氏名(カナ)' },
  { x: 105.4, y: 468.5, size: 8, text: 'スポット 太郎',              label: '被保険者氏名(漢字)' },
];

const RED_BOX = { x: 76, y: 459.5, w: 18, h: 11, label: '被保険者整理番号(値)' };

async function main() {
  const data = await fs.readFile(INPUT);
  const fontBytes = await fs.readFile(FONT_PATH);

  const pdfDoc = await PDFDocument.load(data);
  pdfDoc.registerFontkit(fontkit);

  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  console.log(`Font embedded: ${FONT_PATH}`);

  const pages = pdfDoc.getPages();
  console.log(`Loaded PDF with ${pages.length} pages.`);

  // 1. 白塗りマスク
  console.log('\n[Page 1] Masking:');
  for (const m of PAGE_1_MASKS) {
    pages[0].drawRectangle({ x: m.x, y: m.y, width: m.w, height: m.h, color: rgb(1, 1, 1) });
    console.log(`  ✓ ${m.label}`);
  }
  console.log('\n[Page 3] Masking:');
  for (const m of PAGE_3_MASKS) {
    pages[2].drawRectangle({ x: m.x, y: m.y, width: m.w, height: m.h, color: rgb(1, 1, 1) });
    console.log(`  ✓ ${m.label}`);
  }

  // 2. ダミー値の描画（マスクの上に重ねる）
  console.log('\n[Page 1] Dummy text:');
  for (const t of PAGE_1_DUMMY_TEXTS) {
    pages[0].drawText(t.text, {
      x: t.x,
      y: t.y,
      size: t.size,
      font,
      color: rgb(0, 0, 0),
    });
    console.log(`  ✓ ${t.label}: "${t.text}"`);
  }

  // 3. 被保険者整理番号 (448) を赤枠で囲む
  console.log('\n[Page 1] Red box:');
  pages[0].drawRectangle({
    x: RED_BOX.x, y: RED_BOX.y, width: RED_BOX.w, height: RED_BOX.h,
    borderColor: rgb(1, 0, 0),
    borderWidth: 1.2,
  });
  console.log(`  ✓ ${RED_BOX.label}`);

  const output = await pdfDoc.save();
  await fs.writeFile(OUTPUT, output);
  console.log(`\nSaved: ${OUTPUT}`);
  console.log(`Size: ${(output.length / 1024).toFixed(1)} KB`);
}

main().catch(err => { console.error(err); process.exit(1); });
