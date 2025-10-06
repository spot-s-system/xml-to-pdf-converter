import puppeteer from "puppeteer-core";
import chromium_pkg from "@sparticuz/chromium";

export async function applyXsltTransformation(
  xmlContent: string,
  xslContent: string
): Promise<string> {
  console.log("🔄 XSLT transformation started");

  // Use different chromium based on environment
  const isProduction = process.env.VERCEL || process.env.NODE_ENV === "production";

  let browser;
  try {
    browser = await puppeteer.launch({
      args: isProduction ? chromium_pkg.args : [],
      executablePath: isProduction
        ? await chromium_pkg.executablePath()
        : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    });
    console.log("✅ XSLT Browser launched successfully");
  } catch (error) {
    console.error("❌ XSLT Browser launch failed:", error);
    throw new Error(`XSLT Browser launch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const page = await browser.newPage();

    // Escape content for embedding in JavaScript
    const escapeForJs = (str: string) =>
      str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");

    const transformHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
</head>
<body>
    <div id="result"></div>
    <script>
        const parser = new DOMParser();

        try {
            // Parse XML and XSL
            const xmlDoc = parser.parseFromString(\`${escapeForJs(xmlContent)}\`, "text/xml");
            const xslDoc = parser.parseFromString(\`${escapeForJs(xslContent)}\`, "text/xml");

            // Check for parsing errors
            const xmlError = xmlDoc.querySelector("parsererror");
            const xslError = xslDoc.querySelector("parsererror");

            if (xmlError) {
                throw new Error("XML parsing error: " + xmlError.textContent);
            }
            if (xslError) {
                throw new Error("XSL parsing error: " + xslError.textContent);
            }

            // Create XSLT processor
            const xsltProcessor = new XSLTProcessor();
            xsltProcessor.importStylesheet(xslDoc);

            // Transform
            const resultDoc = xsltProcessor.transformToFragment(xmlDoc, document);

            // Add result to page
            document.getElementById("result").appendChild(resultDoc);

            // Mark transformation as complete
            window.transformComplete = true;
        } catch (error) {
            window.transformError = error.message;
            throw error;
        }
    </script>
</body>
</html>`;

    await page.setContent(transformHtml, { waitUntil: "networkidle0" });

    // Wait for transformation to complete
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = window as any;
        return win.transformComplete || win.transformError;
      },
      { timeout: 10000 }
    );

    // Check for errors
    const error = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).transformError;
    });

    if (error) {
      throw new Error(`XSLT transformation failed: ${error}`);
    }

    // Get the transformed HTML
    const transformedHtml = await page.evaluate(() => {
      const resultDiv = document.getElementById("result");
      return resultDiv ? resultDiv.innerHTML : "";
    });

    return transformedHtml;
  } finally {
    await browser.close();
  }
}
