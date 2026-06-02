// PDFのテキスト項目を位置情報付きで一覧出力するデバッグ用スクリプト
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { promises as fs } from 'fs';

const INPUT = process.argv[2];
if (!INPUT) {
  console.error('Usage: node extract-pdf-text.mjs <input.pdf>');
  process.exit(1);
}

const data = await fs.readFile(INPUT);
const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  console.log(`\n=== Page ${p} (size: ${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)}) ===`);
  const content = await page.getTextContent();
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform;
    const fontSize = Math.abs(d);
    console.log(`  x=${e.toFixed(1)} y=${f.toFixed(1)} w=${item.width.toFixed(1)} h=${fontSize.toFixed(1)} | "${item.str}"`);
  }
}
