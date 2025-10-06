import { chromium } from "playwright";

export async function generatePdfFromHtml(
  htmlContent: string
): Promise<Buffer> {
  console.log("🚀 PDF generation started");

  const browser = await chromium.launch({
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

    // Generate PDF
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
