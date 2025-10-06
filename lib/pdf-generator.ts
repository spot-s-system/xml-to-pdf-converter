import { chromium } from "playwright-core";
import chromium_pkg from "@sparticuz/chromium";

export async function generatePdfFromHtml(
  htmlContent: string
): Promise<Buffer> {
  console.log("🚀 PDF generation started");

  // Use different chromium based on environment
  const isProduction = process.env.VERCEL || process.env.NODE_ENV === "production";

  console.log("📍 Environment:", { isProduction, VERCEL: process.env.VERCEL });

  let browser;
  try {
    // Set font config for Lambda
    if (isProduction) {
      process.env.FONTCONFIG_PATH = '/tmp';
    }

    const execPath = isProduction
      ? await chromium_pkg.executablePath()
      : undefined;
    console.log("📦 Chromium executable path:", execPath);

    browser = await chromium.launch({
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
      executablePath: execPath,
      headless: true,
    });
    console.log("✅ Browser launched successfully");
  } catch (error) {
    console.error("❌ Browser launch failed:", error);
    throw new Error(`Browser launch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewportSize({ width: 1200, height: 1600 });

    console.log("🌐 Loading HTML content");
    await page.setContent(htmlContent, { waitUntil: "networkidle" });

    console.log("✨ Content rendering complete");

    // Give it a moment to fully render
    await page.waitForTimeout(1000);

    // Generate PDF with optimized margins
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "5mm",
        bottom: "5mm",
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
