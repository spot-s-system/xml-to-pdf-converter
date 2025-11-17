import { getBrowser } from "./browser";

export async function generatePdfFromHtml(
  htmlContent: string
): Promise<Buffer> {
  console.log("🚀 PDF generation started");

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {

    // Set viewport for consistent rendering
    await page.setViewport({ width: 1200, height: 1600 });

    console.log("🌐 Loading HTML content");
    await page.setContent(htmlContent, { waitUntil: "domcontentloaded" });

    // Wait for rendering to complete
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).scalingComplete === true;
      },
      { timeout: 3000 }
    ).catch(() => {
      console.log("⚠️ Rendering timeout - proceeding");
    });

    console.log("✨ Content rendering complete");

    // Generate PDF with optimized margins - increased right margin
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "5mm",
        bottom: "5mm",
        left: "5mm",
        right: "10mm",  // Increased right margin to prevent cut-off
      },
    });

    console.log("✅ PDF generated successfully");

    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}
