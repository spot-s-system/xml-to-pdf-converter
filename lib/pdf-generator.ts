import puppeteer from "puppeteer";

export async function generatePdfFromHtml(
  htmlContent: string
): Promise<Buffer> {
  console.log("🚀 PDF generation started");

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // Set viewport for consistent rendering
    await page.setViewport({ width: 1200, height: 1600 });

    console.log("🌐 Loading HTML content");
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    console.log("✨ Content rendering complete");

    // Wait for scaling to complete
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).scalingComplete === true;
      },
      { timeout: 5000 }
    ).catch(() => {
      console.log("⚠️ Scaling timeout - proceeding without scaling");
    });

    // Give it a moment to fully render after scaling
    await new Promise(resolve => setTimeout(resolve, 500));

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
