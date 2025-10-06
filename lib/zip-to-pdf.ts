import { applyXsltTransformation } from "./xslt-processor";
import { generatePdfFromHtml } from "./pdf-generator";
import { optimizeXslForPdf } from "./xsl-adjuster";
import {
  extractInsuredPersonsFrom7130001,
  extractInsuredPersonsFrom7200001,
  extractInsuredPersonsFromHenrei,
  extractBusinessOwnerFromKagami,
  sanitizeFileName,
} from "./xml-parser";
import JSZip from "jszip";

interface ExtractedFiles {
  [filename: string]: string | Buffer;
}

interface PdfFile {
  filename: string;
  buffer: Buffer;
}

export async function convertZipToPdfZip(
  files: ExtractedFiles,
  originalFilename: string
): Promise<Buffer> {
  const pdfFiles: PdfFile[] = [];

  // 表紙（kagami）の処理
  // 到達番号のXMLファイルを検出（通知書以外のXML）
  const kagamiXml = Object.keys(files).find(
    (f) => !f.includes("7130001") && !f.includes("7200001") && !f.includes("henrei") && f.endsWith(".xml")
  );

  const kagamiXsl = Object.keys(files).find(
    (f) => f.includes("kagami") && f.endsWith(".xsl")
  );

  console.log(`🔍 Detected kagami XML: ${kagamiXml}, XSL: ${kagamiXsl}`);

  if (kagamiXml && kagamiXsl) {
    const xmlContent = files[kagamiXml] as string;
    const xslContent = files[kagamiXsl] as string;
    const businessOwner = extractBusinessOwnerFromKagami(xmlContent);

    try {
      console.log(`🔄 Processing kagami: ${kagamiXml}`);
      const html = await applyXsltTransformation(
        xmlContent,
        optimizeXslForPdf(xslContent)
      );
      const wrappedHtml = wrapHtmlForPdf(html);
      const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

      // ファイル名: {到達番号}_{事業主名}.pdf
      const docNumber = kagamiXml.replace(/\.(xml|XML)$/, "");
      const filename = `${docNumber}_${sanitizeFileName(businessOwner)}.pdf`;

      pdfFiles.push({ filename, buffer: pdfBuffer });
      console.log(`✅ Generated: ${filename}`);
    } catch (error) {
      console.error(`❌ Failed to convert ${kagamiXml}:`, error);
      console.error(`Stack trace:`, error instanceof Error ? error.stack : "");
    }
  }

  // 7130001.xml (標準報酬決定通知書) の処理
  const xml7130001 = Object.keys(files).find((f) => /7130001\.xml$/i.test(f));
  const xsl7130001 = Object.keys(files).find((f) => /7130001\.xsl$/i.test(f));

  if (xml7130001 && xsl7130001) {
    const xmlContent = files[xml7130001] as string;
    const xslContent = files[xsl7130001] as string;
    const persons = extractInsuredPersonsFrom7130001(xmlContent);

    for (const person of persons) {
      try {
        const html = await applyXsltTransformation(
          person.xmlContent,
          optimizeXslForPdf(xslContent)
        );
        const wrappedHtml = wrapHtmlForPdf(html);
        const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

        const filename = `7130001_${sanitizeFileName(person.name)}.pdf`;
        pdfFiles.push({ filename, buffer: pdfBuffer });
        console.log(`✅ Generated: ${filename}`);
      } catch (error) {
        console.error(`Failed to convert 7130001 for ${person.name}:`, error);
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

    for (const person of persons) {
      try {
        const html = await applyXsltTransformation(
          person.xmlContent,
          optimizeXslForPdf(xslContent)
        );
        const wrappedHtml = wrapHtmlForPdf(html);
        const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

        const filename = `7200001_${sanitizeFileName(person.name)}.pdf`;
        pdfFiles.push({ filename, buffer: pdfBuffer });
        console.log(`✅ Generated: ${filename}`);
      } catch (error) {
        console.error(`Failed to convert 7200001 for ${person.name}:`, error);
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

    for (const person of persons) {
      try {
        const html = await applyXsltTransformation(
          person.xmlContent,
          optimizeXslForPdf(xslContent)
        );
        const wrappedHtml = wrapHtmlForPdf(html);
        const pdfBuffer = await generatePdfFromHtml(wrappedHtml);

        const filename = `henrei_${sanitizeFileName(person.name)}.pdf`;
        pdfFiles.push({ filename, buffer: pdfBuffer });
        console.log(`✅ Generated: ${filename}`);
      } catch (error) {
        console.error(`Failed to convert henrei for ${person.name}:`, error);
      }
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

  console.log(`📦 Created ZIP with ${pdfFiles.length} PDFs + ${Object.keys(files).length} original files`);

  return zipBuffer;
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
