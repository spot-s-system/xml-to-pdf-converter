import { chromium } from "playwright-core";
import chromium_pkg from "@sparticuz/chromium-min";

export interface ConversionOptions {
  xmlContent: string;
  xslContent: string;
}

export async function convertXmlToPdf(
  options: ConversionOptions
): Promise<Buffer> {
  const { xmlContent, xslContent } = options;

  console.log("🚀 XML to PDF conversion started");

  // Use different chromium based on environment
  const isProduction = process.env.VERCEL || process.env.NODE_ENV === "production";

  // ブラウザを起動
  const browser = await chromium.launch({
    args: isProduction
      ? [
          ...chromium_pkg.args,
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--no-zygote',
          '--no-sandbox',
        ]
      : [],
    executablePath: isProduction
      ? await chromium_pkg.executablePath('/tmp')
      : undefined,
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // XSLT変換を実行するHTMLページを作成
    const transformHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: "MS Gothic", "Yu Gothic", sans-serif;
        }
        #result {
            width: 100%;
        }
    </style>
</head>
<body>
    <div id="result"></div>
    <script>
        // XMLパーサー
        const parser = new DOMParser();
        const serializer = new XMLSerializer();

        // XMLとXSLをパース
        const xmlDoc = parser.parseFromString(\`${xmlContent.replace(/`/g, "\\`")}\`, "text/xml");
        const xslDoc = parser.parseFromString(\`${xslContent.replace(/`/g, "\\`")}\`, "text/xml");

        // XSLTプロセッサで変換
        const xsltProcessor = new XSLTProcessor();
        xsltProcessor.importStylesheet(xslDoc);

        // 変換実行
        const resultDoc = xsltProcessor.transformToFragment(xmlDoc, document);

        // 結果を表示
        document.getElementById("result").appendChild(resultDoc);

        // 変換完了フラグ
        window.transformComplete = true;
    </script>
</body>
</html>
`;

    console.log("🌐 Loading HTML with XSLT transformation");
    await page.setContent(transformHtml, { waitUntil: "networkidle" });

    // 変換完了を待つ
    await page.waitForFunction(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).transformComplete;
    }, {
      timeout: 10000,
    });

    console.log("✨ XSLT transformation complete");

    // 少し待ってレンダリングを安定させる
    await page.waitForTimeout(1000);

    // PDFとして生成
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        bottom: "10mm",
        left: "10mm",
        right: "10mm",
      },
    });

    console.log("✅ PDF generated successfully");

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
