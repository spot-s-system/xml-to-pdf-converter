// 算定基礎届の 7130001 フォルダで何が起きるかをトレースするスクリプト
// （Puppeteer は使わず、検出・命名ロジックだけ実行）
import { promises as fs } from 'fs';
import path from 'path';

const FOLDER = String.raw`C:\Users\koiwa\AppData\Local\Temp\zipcheck4\0002_株式会社VALM_[社保]算定基礎,70歳以上被用者算定基礎(CSV方式)_2025・・・`;

// detectDocumentPairs を簡略再現
const files = await fs.readdir(FOLDER);
console.log('Files in folder:', files);

const xmlFiles = files.filter(f => f.toLowerCase().endsWith('.xml'));
const xslFiles = files.filter(f => f.toLowerCase().endsWith('.xsl'));
console.log('\nXML files:', xmlFiles);
console.log('XSL files:', xslFiles);

console.log('\n--- Pair detection ---');
for (const xmlFile of xmlFiles) {
  const baseName = path.basename(xmlFile, path.extname(xmlFile));
  const isKagami = baseName.toLowerCase() === 'kagami' || /^\d{18}$/.test(baseName);
  console.log(`\n${xmlFile}: baseName=${baseName}, isKagami=${isKagami}`);

  let xslFile;
  if (isKagami) {
    xslFile = xslFiles.find(f => path.basename(f, path.extname(f)).toLowerCase() === 'kagami');
  } else {
    xslFile = xslFiles.find(f => path.basename(f, path.extname(f)) === baseName);
  }
  console.log(`  Matched XSL: ${xslFile ?? 'NONE'}`);
}

// 7130001.xml の被保険者抽出をシミュレート
console.log('\n--- 7130001.xml insurer extraction ---');
const xmlContent = await fs.readFile(path.join(FOLDER, '7130001.xml'), 'utf-8');

// 1) 被保険者ブロック数
const insurerBlocks = xmlContent.match(/<_被保険者>[\s\S]*?<\/_被保険者>/g);
console.log(`Insurer blocks: ${insurerBlocks?.length ?? 0}`);

// 2) 各ブロックから名前抽出
const names = [];
if (insurerBlocks) {
  for (const block of insurerBlocks) {
    let nameMatch = block.match(/<被用者漢字氏名>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/被用者漢字氏名>/);
    if (!nameMatch) {
      nameMatch = block.match(/<被保険者(?:漢字)?氏名>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/被保険者(?:漢字)?氏名>/);
    }
    names.push(nameMatch ? nameMatch[1].trim() : null);
  }
}
console.log('Extracted names (first 5):', names.slice(0, 5));
console.log('Names with empty/null:', names.filter(n => !n).length);
console.log('Total successful extractions:', names.filter(n => n).length);
console.log(`Match check: insurerBlocks(${insurerBlocks?.length}) === allInsurers(${names.filter(n => n).length})?`,
  insurerBlocks?.length === names.filter(n => n).length);

// 3) 適用年月の抽出
const applicableEraMatch = xmlContent.match(/<適用年月_元号>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/適用年月_元号>/);
const applicableYearMatch = xmlContent.match(/<適用年月_年>(?:<!\[CDATA\[)?\s*(\d+)(?:\]\]>)?<\/適用年月_年>/);
const applicableMonthMatch = xmlContent.match(/<適用年月_月>(?:<!\[CDATA\[)?\s*(\d+)(?:\]\]>)?<\/適用年月_月>/);
console.log('\n--- 適用年月 extraction ---');
console.log('元号:', applicableEraMatch?.[1]);
console.log('年:', applicableYearMatch?.[1]);
console.log('月:', applicableMonthMatch?.[1]);

// 4) 命名: applyShahoSanteiKisoYearPrefix
const folderName = path.basename(FOLDER);
console.log('\nfolderName:', folderName);
console.log('Has [社保]算定基礎?', /\[社保\]算定基礎/.test(folderName));

const era = applicableEraMatch?.[1];
const year = applicableYearMatch?.[1]?.padStart(2, '0');
const month = applicableMonthMatch?.[1]?.padStart(2, '0');
const applicableDate = era && year && month ? `${era}${year}年${month}月` : null;
console.log('applicableDate:', applicableDate);
const yearForPrefix = applicableDate?.match(/^R(\d+)年/)?.[1];
console.log('Reiwa year for prefix:', yearForPrefix);

const firstName = names[0];
const baseFilename = `${firstName}様_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf`;
const finalFilename = yearForPrefix
  ? `令和${parseInt(yearForPrefix, 10)}年度算定_${baseFilename}`
  : baseFilename;
console.log('\nExpected first PDF filename:', finalFilename);
