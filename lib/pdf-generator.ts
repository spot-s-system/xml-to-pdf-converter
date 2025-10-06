import { chromium } from "playwright-core";
import chromium_pkg from "@sparticuz/chromium";

export async function generatePdfFromHtml(
  htmlContent: string
): Promise<Buffer> {
  console.log("🚀 PDF generation started");

  // Use different chromium based on environment
  const isProduction = process.env.VERCEL || process.env.NODE_ENV === "production";

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
