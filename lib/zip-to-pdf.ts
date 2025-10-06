import { applyXsltTransformation } from "./xslt-processor";
import { generatePdfFromHtml } from "./pdf-generator";
import { optimizeXslForPdf } from "./xsl-adjuster";

interface ExtractedFiles {
  [filename: string]: string | Buffer;
}

interface DocumentGroup {
  mainXml: string;
  mainXmlContent: string;
  xslContent: string;
  title: string;
}

export async function convertZipToPdf(
  files: ExtractedFiles
): Promise<Buffer> {
  // Identify document structure
  const documentGroups: DocumentGroup[] = [];

  // Find kagami.xml (cover page) if exists
  const kagamiXml = Object.keys(files).find(
    (f) => f.includes("kagami") && f.endsWith(".xml")
  );
  const kagamiXsl = Object.keys(files).find(
    (f) => f.includes("kagami") && f.endsWith(".xsl")
  );

  // Add kagami as first document if exists
  if (kagamiXml && kagamiXsl) {
    const kagamiXmlContent = files[kagamiXml] as string;
    // Extract the main BODY content from kagami
    const bodyMatch = kagamiXmlContent.match(
      /<BODY[^>]*>([\s\S]*?)<\/BODY>/i
    );
    if (bodyMatch) {
      const bodyContent = bodyMatch[0];
      documentGroups.push({
        mainXml: kagamiXml,
        mainXmlContent: bodyContent,
        xslContent: optimizeXslForPdf(files[kagamiXsl] as string),
        title: "表紙",
      });
    }
  }

  // Find notification documents (7130001, 7200001, henrei, etc.)
  const notificationPatterns = [
    { pattern: /^7130001\.xml$/i, title: "標準報酬決定通知書" },
    { pattern: /^7200001\.xml$/i, title: "70歳以上被用者通知書" },
    { pattern: /^henrei\.xml$/i, title: "返戻票" },
  ];

  for (const { pattern, title } of notificationPatterns) {
    const xmlFile = Object.keys(files).find((f) => pattern.test(f));
    if (xmlFile) {
      const xslFile = xmlFile.replace(".xml", ".xsl");
      if (files[xslFile]) {
        documentGroups.push({
          mainXml: xmlFile,
          mainXmlContent: files[xmlFile] as string,
          xslContent: optimizeXslForPdf(files[xslFile] as string),
          title,
        });
      }
    }
  }

  // If no structured documents found, try to find any XML/XSL pairs
  if (documentGroups.length === 0) {
    const xmlFiles = Object.keys(files).filter(
      (f) => f.endsWith(".xml") && !f.includes("kagami")
    );
    for (const xmlFile of xmlFiles) {
      const xslFile = xmlFile.replace(".xml", ".xsl");
      if (files[xslFile]) {
        documentGroups.push({
          mainXml: xmlFile,
          mainXmlContent: files[xmlFile] as string,
          xslContent: optimizeXslForPdf(files[xslFile] as string),
          title: xmlFile.replace(".xml", ""),
        });
      }
    }
  }

  if (documentGroups.length === 0) {
    throw new Error(
      "No valid XML/XSL document pairs found in the ZIP archive"
    );
  }

  // Convert each document group to HTML
  const htmlPages: string[] = [];

  for (const group of documentGroups) {
    try {
      const html = await applyXsltTransformation(
        group.mainXmlContent,
        group.xslContent
      );
      htmlPages.push(html);
    } catch (error) {
      console.error(`Failed to transform ${group.mainXml}:`, error);
      // Add error page
      htmlPages.push(`
        <div>
          <h1>変換エラー</h1>
          <p>ドキュメント: ${group.title}</p>
          <p>エラー: ${error instanceof Error ? error.message : String(error)}</p>
        </div>
      `);
    }
  }

  // Combine all HTML pages and convert to PDF
  // Preserve original XSL layout as designed for browser display
  const combinedHtml = `
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
        /* Page breaks between documents */
        .page-break {
            page-break-after: always;
        }
        /* Preserve original layout dimensions */
        .document-container {
            margin: 0 auto;
            page-break-inside: avoid;
        }
    </style>
</head>
<body>
    ${htmlPages.map(html => `<div class="document-container">${html}</div>`).join('<div class="page-break"></div>')}
    <script>
        // Signal that rendering is complete
        window.addEventListener('load', () => {
            window.scalingComplete = true;
        });
    </script>
</body>
</html>`;

  const pdfBuffer = await generatePdfFromHtml(combinedHtml);

  return pdfBuffer;
}
