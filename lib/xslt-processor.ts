import { getBrowser } from "./browser-pool";

export async function applyXsltTransformation(
  xmlContent: string,
  xslContent: string
): Promise<string> {
  console.log("🔄 XSLT transformation started");

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {

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
                const errorText = xslError.textContent || "";
                // Extract line and column information if available
                const lineMatch = errorText.match(/line (\\d+)/);
                const colMatch = errorText.match(/column (\\d+)/);
                const line = lineMatch ? lineMatch[1] : "unknown";
                const col = colMatch ? colMatch[1] : "unknown";
                throw new Error(\`XSL parsing error at line \${line}, column \${col}: \${errorText}\`);
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

    await page.setContent(transformHtml, { waitUntil: "domcontentloaded" });

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

    console.log("✅ XSLT transformation completed");
    return transformedHtml;
  } finally {
    await page.close();
  }
}
