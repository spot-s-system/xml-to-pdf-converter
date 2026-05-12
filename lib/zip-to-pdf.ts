import { applyXsltTransformation } from "./xslt-processor";
import { generatePdfFromHtml } from "./pdf-generator";
import { optimizeXslForPdf } from "./xsl-adjuster";
import {
  extractInsuredPersonsFrom7100001,
  extractInsuredPersonsFrom7130001,
  extractInsuredPersonsFrom7140001,
  extractInsuredPersonsFrom7200001,
  extractInsuredPersonsFrom7210001,
  extractInsuredPersonsFromHenrei,
  extractBusinessOwnerFromKagami,
  extractGenericInsuredPersonName,
  sanitizeFileName,
} from "./xml-parser";
import { generatePdfFilename, generatePdfFilenameFor7140001, generatePdfFilenameFor7210001 } from "./document-names";
import JSZip from "jszip";

interface ExtractedFiles {
  [filename: string]: string | Buffer;
}

interface PdfFile {
  filename: string;
  buffer: Buffer;
}

type LogCallback = (message: string) => void;

/**
 * XMLからXSLファイル名を抽出
 */
function extractXslFilename(xmlContent: string): string | null {
  // xml-stylesheet processing instructionから抽出
  const stylesheetMatch = xmlContent.match(/<\?xml-stylesheet[^>]+href="([^"]+)"/);
  if (stylesheetMatch && stylesheetMatch[1]) {
    return stylesheetMatch[1];
  }

  // <STYLESHEET>タグから抽出
  const tagMatch = xmlContent.match(/<STYLESHEET>([^<]+)<\/STYLESHEET>/);
  if (tagMatch && tagMatch[1]) {
    return tagMatch[1];
  }

  return null;
}

/**
 * ファイル名からディレクトリパスを除去
 */
function getBasename(filepath: string): string {
  return filepath.split('/').pop() || filepath;
}

export async function convertZipToPdfZip(
  files: ExtractedFiles,
  onLog?: LogCallback
): Promise<Buffer> {
  const pdfFiles: PdfFile[] = [];
  const processedXmlFiles = new Set<string>(); // 処理済みXMLファイルを記録

  const log = (message: string) => {
    console.log(message);
    onLog?.(message);
  };

  // 表紙（kagami）の処理
  // 到達番号のXMLファイルを検出（通知書以外のXML）
  const kagamiXml = Object.keys(files).find(
    (f) => !f.includes("7100001") && !f.includes("7130001") && !f.includes("7140001") && !f.includes("7150001") && !f.includes("7200001") && !f.includes("7210001") && !f.includes("henrei") && f.endsWith(".xml")
  );

  const kagamiXsl = Object.keys(files).find(
    (f) => f.includes("kagami") && f.endsWith(".xsl")
  );

  log(`🔍 Detected kagami XML: ${kagamiXml}, XSL: ${kagamiXsl}`);

  if (kagamiXml && kagamiXsl) {
    const xmlContent = files[kagamiXml] as string;
    const xslContent = files[kagamiXsl] as string;
    const businessOwner = extractBusinessOwnerFromKagami(xmlContent);

    try {
      log(`🔄 Processing kagami: ${kagamiXml}`);
      const html = await applyXsltTransformation(
        xmlContent,
        optimizeXslForPdf(xslContent)
      );
      const wrappedHtml = wrapHtmlForPdf(html);
      const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

      // ファイル名: {事業主名}様_{通知書名}.pdf
      const filename = generatePdfFilename([businessOwner], "kagami");

      pdfFiles.push({ filename, buffer: pdfBuffer });
      processedXmlFiles.add(kagamiXml); // 処理済みとして記録
      log(`✅ Generated: ${filename}`);
    } catch (error) {
      const errorMsg = `❌ Failed to convert ${kagamiXml}: ${error instanceof Error ? error.message : String(error)}`;
      log(errorMsg);
      console.error(`Stack trace:`, error instanceof Error ? error.stack : "");
    }
  }

  // 7100001.xml (資格取得確認および標準報酬決定通知書) の処理
  const xml7100001 = Object.keys(files).find((f) => /7100001\.xml$/i.test(f));
  const xsl7100001 = Object.keys(files).find((f) => /7100001\.xsl$/i.test(f));

  if (xml7100001 && xsl7100001) {
    const xmlContent = files[xml7100001] as string;
    const xslContent = files[xsl7100001] as string;
    const persons = extractInsuredPersonsFrom7100001(xmlContent);

    if (persons.length > 0) {
      // 各被保険者ごとに個別のPDFを生成
      for (const person of persons) {
        try {
          log(`🔄 Processing 7100001 for: ${person.name}`);
          const html = await applyXsltTransformation(
            person.xmlContent,
            optimizeXslForPdf(xslContent)
          );
          const wrappedHtml = wrapHtmlForPdf(html);
          const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

          // ファイル名: {名前}様_{通知書名}.pdf
          const filename = generatePdfFilename([person.name], "7100001");
          pdfFiles.push({ filename, buffer: pdfBuffer });
          log(`✅ Generated: ${filename}`);
        } catch (error) {
          const errorMsg = `❌ Failed to convert 7100001 for ${person.name}: ${error instanceof Error ? error.message : String(error)}`;
          log(errorMsg);
        }
      }
      processedXmlFiles.add(xml7100001); // 処理済みとして記録
    }
  }

  // 7130001.xml (標準報酬決定通知書) の処理
  const xml7130001 = Object.keys(files).find((f) => /7130001\.xml$/i.test(f));
  const xsl7130001 = Object.keys(files).find((f) => /7130001\.xsl$/i.test(f));

  if (xml7130001 && xsl7130001) {
    const xmlContent = files[xml7130001] as string;
    const xslContent = files[xsl7130001] as string;
    const persons = extractInsuredPersonsFrom7130001(xmlContent);

    if (persons.length > 0) {
      // 各被保険者ごとに個別のPDFを生成
      for (const person of persons) {
        try {
          log(`🔄 Processing 7130001 for: ${person.name}`);
          const html = await applyXsltTransformation(
            person.xmlContent,
            optimizeXslForPdf(xslContent)
          );
          const wrappedHtml = wrapHtmlForPdf(html);
          const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

          // ファイル名: {名前}様_{通知書名}.pdf
          const filename = generatePdfFilename([person.name], "7130001");
          pdfFiles.push({ filename, buffer: pdfBuffer });
          log(`✅ Generated: ${filename}`);
        } catch (error) {
          const errorMsg = `❌ Failed to convert 7130001 for ${person.name}: ${error instanceof Error ? error.message : String(error)}`;
          log(errorMsg);
        }
      }
      processedXmlFiles.add(xml7130001); // 処理済みとして記録
    }
  }

  // 7140001.xml (標準報酬改定通知書) の処理
  const xml7140001 = Object.keys(files).find((f) => /7140001\.xml$/i.test(f));
  const xsl7140001 = Object.keys(files).find((f) => /7140001\.xsl$/i.test(f));

  if (xml7140001 && xsl7140001) {
    const xmlContent = files[xml7140001] as string;
    const xslContent = files[xsl7140001] as string;
    const persons = extractInsuredPersonsFrom7140001(xmlContent);

    if (persons.length > 0) {
      try {
        // 複数の被保険者のHTMLを結合
        const htmlPages: string[] = [];

        for (const person of persons) {
          const html = await applyXsltTransformation(
            person.xmlContent,
            optimizeXslForPdf(xslContent)
          );
          htmlPages.push(html);
        }

        // 全てのHTMLを1つのPDFにまとめる
        const combinedHtml = combineHtmlPages(htmlPages);
        const pdfBuffer = await generatePdfFromHtml(combinedHtml);

        // ファイル名: {適用年月}_{通知書名}.pdf
        // 全員の改定年月が同じと仮定して、最初の被保険者の改定年月を使用
        const filename = generatePdfFilenameFor7140001(persons[0].revisionDate, "7140001");
        pdfFiles.push({ filename, buffer: pdfBuffer });
        processedXmlFiles.add(xml7140001); // 処理済みとして記録
        log(`✅ Generated: ${filename} (${persons.length}名を統合)`);
      } catch (error) {
        const errorMsg = `❌ Failed to convert 7140001: ${error instanceof Error ? error.message : String(error)}`;
        log(errorMsg);
      }
    }
  }

  // 7200001.xml (70歳以上被用者) の処理
  const xml7200001 = Object.keys(files).find((f) => /7200001\.xml$/i.test(f));
  const xsl7200001 = Object.keys(files).find((f) => /7200001\.xsl$/i.test(f));

  if (xml7200001 && xsl7200001) {
    const xmlContent = files[xml7200001] as string;
    const xslContent = files[xsl7200001] as string;
    const persons = extractInsuredPersonsFrom7200001(xmlContent);

    if (persons.length > 0) {
      // 各被保険者ごとに個別のPDFを生成
      for (const person of persons) {
        try {
          log(`🔄 Processing 7200001 for: ${person.name}`);
          const html = await applyXsltTransformation(
            person.xmlContent,
            optimizeXslForPdf(xslContent)
          );
          const wrappedHtml = wrapHtmlForPdf(html);
          const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

          // ファイル名: {名前}様_{通知書名}.pdf
          const filename = generatePdfFilename([person.name], "7200001");
          pdfFiles.push({ filename, buffer: pdfBuffer });
          log(`✅ Generated: ${filename}`);
        } catch (error) {
          const errorMsg = `❌ Failed to convert 7200001 for ${person.name}: ${error instanceof Error ? error.message : String(error)}`;
          log(errorMsg);
        }
      }
      processedXmlFiles.add(xml7200001); // 処理済みとして記録
    }
  }

  // 7210001.xml (70歳以上被用者月額改定) の処理
  const xml7210001 = Object.keys(files).find((f) => /7210001\.xml$/i.test(f));
  const xsl7210001 = Object.keys(files).find((f) => /7210001\.xsl$/i.test(f));

  if (xml7210001 && xsl7210001) {
    const xmlContent = files[xml7210001] as string;
    const xslContent = files[xsl7210001] as string;
    const persons = extractInsuredPersonsFrom7210001(xmlContent);

    if (persons.length > 0) {
      try {
        // 複数の被保険者のHTMLを結合
        const htmlPages: string[] = [];

        for (const person of persons) {
          const html = await applyXsltTransformation(
            person.xmlContent,
            optimizeXslForPdf(xslContent)
          );
          htmlPages.push(html);
        }

        // 全てのHTMLを1つのPDFにまとめる
        const combinedHtml = combineHtmlPages(htmlPages);
        const pdfBuffer = await generatePdfFromHtml(combinedHtml);

        // ファイル名: {改定年月}_{通知書名}.pdf
        // 全員の改定年月が同じと仮定して、最初の被保険者の改定年月を使用
        const filename = generatePdfFilenameFor7210001(persons[0].revisionDate, "7210001");
        pdfFiles.push({ filename, buffer: pdfBuffer });
        processedXmlFiles.add(xml7210001); // 処理済みとして記録
        log(`✅ Generated: ${filename} (${persons.length}名を統合)`);
      } catch (error) {
        const errorMsg = `❌ Failed to convert 7210001: ${error instanceof Error ? error.message : String(error)}`;
        log(errorMsg);
      }
    }
  }

  // henrei.xml (返戻票) の処理
  const xmlHenrei = Object.keys(files).find((f) => /henrei\.xml$/i.test(f));
  const xslHenrei = Object.keys(files).find((f) => /henrei\.xsl$/i.test(f));

  if (xmlHenrei && xslHenrei) {
    const xmlContent = files[xmlHenrei] as string;
    const xslContent = files[xslHenrei] as string;
    const persons = extractInsuredPersonsFromHenrei(xmlContent);

    if (persons.length > 0) {
      try {
        // 複数の被保険者のHTMLを結合
        const htmlPages: string[] = [];
        const names: string[] = [];

        for (const person of persons) {
          const html = await applyXsltTransformation(
            person.xmlContent,
            optimizeXslForPdf(xslContent)
          );
          htmlPages.push(html);
          names.push(person.name);
        }

        // 全てのHTMLを1つのPDFにまとめる
        const combinedHtml = combineHtmlPages(htmlPages);
        const pdfBuffer = await generatePdfFromHtml(combinedHtml);

        // ファイル名: {名前}様{他N名}_{通知書名}.pdf
        const filename = generatePdfFilename(names, "henrei");
        pdfFiles.push({ filename, buffer: pdfBuffer });
        processedXmlFiles.add(xmlHenrei); // 処理済みとして記録
        log(`✅ Generated: ${filename} (${persons.length}名)`);
      } catch (error) {
        const errorMsg = `❌ Failed to convert henrei: ${error instanceof Error ? error.message : String(error)}`;
        log(errorMsg);
      }
    }
  }

  // 汎用的なXML/XSLペアの処理（まだ処理されていないXMLファイル）
  log(`\n🔍 Scanning for unprocessed XML/XSL pairs...`);

  const allXmlFiles = Object.keys(files).filter((f) => f.endsWith(".xml"));
  const unprocessedXmlFiles = allXmlFiles.filter((f) => !processedXmlFiles.has(f));

  log(`📊 Found ${unprocessedXmlFiles.length} unprocessed XML files`);

  for (const xmlFile of unprocessedXmlFiles) {
    const xmlContent = files[xmlFile] as string;

    // XMLからXSLファイル名を抽出
    const xslFilename = extractXslFilename(xmlContent);

    if (!xslFilename) {
      log(`⚠️  Skipping ${xmlFile}: No XSL reference found`);
      continue;
    }

    // XSLファイルを検索（同じディレクトリ内またはルート）
    const xmlDir = xmlFile.includes('/') ? xmlFile.substring(0, xmlFile.lastIndexOf('/') + 1) : '';
    const possibleXslPaths = [
      xmlDir + xslFilename,  // 同じディレクトリ
      xslFilename,           // ルートディレクトリ
    ];

    let xslFile: string | null = null;
    for (const path of possibleXslPaths) {
      if (files[path]) {
        xslFile = path;
        break;
      }
    }

    if (!xslFile) {
      log(`⚠️  Skipping ${xmlFile}: XSL file not found (${xslFilename})`);
      continue;
    }

    try {
      log(`🔄 Processing generic XML/XSL pair: ${xmlFile}`);
      const xslContent = files[xslFile] as string;

      const html = await applyXsltTransformation(
        xmlContent,
        optimizeXslForPdf(xslContent)
      );
      const wrappedHtml = wrapHtmlForPdf(html);
      const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

      // 被保険者名を抽出（可能であれば）
      const insuredPersonName = extractGenericInsuredPersonName(xmlContent);

      // ファイル名を生成
      let filename: string;
      const baseFilename = getBasename(xmlFile).replace(/\.xml$/i, '');

      if (insuredPersonName) {
        // 被保険者名が見つかった場合: {名前}様_{元のファイル名}.pdf
        const sanitizedName = sanitizeFileName(insuredPersonName);
        filename = `${sanitizedName}様_${baseFilename}.pdf`;
        log(`📝 Extracted insured person name: ${insuredPersonName}`);
      } else {
        // 被保険者名が見つからない場合: 元のファイル名.pdf
        filename = `${baseFilename}.pdf`;
      }

      pdfFiles.push({ filename, buffer: pdfBuffer });
      processedXmlFiles.add(xmlFile);
      log(`✅ Generated: ${filename}`);
    } catch (error) {
      const errorMsg = `❌ Failed to convert ${xmlFile}: ${error instanceof Error ? error.message : String(error)}`;
      log(errorMsg);
      console.error(`Stack trace:`, error instanceof Error ? error.stack : "");
    }
  }

  // 新しいZIPファイルを作成
  const zip = new JSZip();

  // 元のファイルを全て追加
  for (const [filename, content] of Object.entries(files)) {
    if (typeof content === "string") {
      zip.file(filename, content);
    } else {
      zip.file(filename, content);
    }
  }

  // 生成したPDFを追加
  for (const pdfFile of pdfFiles) {
    zip.file(pdfFile.filename, pdfFile.buffer);
  }

  // ZIPをバッファに変換
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  log(`📦 Created ZIP with ${pdfFiles.length} PDFs + ${Object.keys(files).length} original files`);

  return zipBuffer;
}

/**
 * 複数のHTMLページを1つのPDFにまとめる
 */
function combineHtmlPages(htmlPages: string[]): string {
  const combinedContent = htmlPages
    .map((html) => `<div class="document-container">${html}</div>`)
    .join('<div class="page-break"></div>');

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 20px;
            font-family: "MS Gothic", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        @page {
            size: A4;
            margin: 5mm 10mm;
        }
        .document-container {
            margin: 0 auto;
        }
        .page-break {
            page-break-after: always;
        }
    </style>
</head>
<body>
    ${combinedContent}
    <script>
        window.addEventListener('load', () => {
            window.scalingComplete = true;
        });
    </script>
</body>
</html>`;
}

/**
 * HTMLを1ページ用にラップ
 */
function wrapHtmlForPdf(html: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 20px;
            font-family: "MS Gothic", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        @page {
            size: A4;
            margin: 5mm 10mm;
        }
        /* 1ページに収める - page-break-inside削除 */
        .document-container {
            margin: 0 auto;
        }
    </style>
</head>
<body>
    <div class="document-container">
        ${html}
    </div>
    <script>
        window.addEventListener('load', () => {
            window.scalingComplete = true;
        });
    </script>
</body>
</html>`;
}
