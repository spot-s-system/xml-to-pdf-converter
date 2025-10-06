import puppeteer from "puppeteer-core";
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
    browser = await puppeteer.launch({
      args: isProduction ? chromium_pkg.args : [],
      executablePath: isProduction
        ? await chromium_pkg.executablePath()
        : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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
    await page.setViewport({ width: 1200, height: 1600 });

    console.log("🌐 Loading HTML content");
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    console.log("✨ Content rendering complete");

    // Give it a moment to fully render
    await new Promise(resolve => setTimeout(resolve, 1000));

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
