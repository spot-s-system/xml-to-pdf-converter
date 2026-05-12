import { getBrowser } from "./browser-pool";

export async function generatePdfFromHtml(
  htmlContent: string
): Promise<Buffer> {
  console.log("🚀 PDF generation started");

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {

    // Set viewport for consistent rendering
    await page.setViewport({ width: 1200, height: 1600 });

    // bulk経路では HTML 側に scalingComplete セット用のスクリプトが入っていないため
    // 毎回 3 秒の waitForFunction がタイムアウトで浪費されていた。
    // 新規ドキュメントごとに load 完了で scalingComplete を立てるスクリプトを注入し、
    // 単体経路(既にHTML側で同じことをしている)と整合させる。
    await page.evaluateOnNewDocument(() => {
      window.addEventListener('load', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).scalingComplete = true;
      });
    });

    console.log("🌐 Loading HTML content");
    await page.setContent(htmlContent, { waitUntil: "domcontentloaded" });

    // Wait for rendering to complete (load 発火で即座に解決される想定)
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
