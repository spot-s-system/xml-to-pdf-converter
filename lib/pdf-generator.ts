import jsPDF from "jspdf";
import { JSDOM } from "jsdom";

export async function generatePdfFromHtml(
  htmlContent: string
): Promise<Buffer> {
  console.log("🚀 PDF generation started");

  try {
    // Parse HTML using JSDOM
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;

    // Create PDF
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    // Extract text content and basic layout
    const bodyElement = document.querySelector("body");
    if (!bodyElement) {
      throw new Error("No body element found in HTML");
    }

    let yPosition = 10;
    const pageWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const margin = 10;
    const maxWidth = pageWidth - 2 * margin;

    // Process tables and text
    const tables = bodyElement.querySelectorAll("table");

    for (const table of Array.from(tables)) {
      const rows = table.querySelectorAll("tr");

      for (const row of Array.from(rows)) {
        const cells = row.querySelectorAll("td, th");
        let xPosition = margin;
        const cellWidth = maxWidth / cells.length;

        for (const cell of Array.from(cells)) {
          const text = cell.textContent?.trim() || "";

          // Check if we need a new page
          if (yPosition > pageHeight - margin) {
            pdf.addPage();
            yPosition = margin;
          }

          // Set font size based on element type
          const fontSize = cell.tagName === "TH" ? 10 : 8;
          pdf.setFontSize(fontSize);

          // Draw cell text
          const lines = pdf.splitTextToSize(text, cellWidth - 2);
          pdf.text(lines, xPosition + 1, yPosition);

          xPosition += cellWidth;
        }

        yPosition += 8; // Row height
      }

      yPosition += 5; // Space between tables
    }

    // Handle non-table content
    const nonTableElements = Array.from(bodyElement.children).filter(
      (el) => el.tagName !== "TABLE" && el.tagName !== "DIV" || el.className === "page-break"
    );

    for (const element of nonTableElements) {
      if (element.className === "page-break") {
        pdf.addPage();
        yPosition = margin;
        continue;
      }

      const text = element.textContent?.trim() || "";
      if (text) {
        if (yPosition > pageHeight - margin) {
          pdf.addPage();
          yPosition = margin;
        }

        pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(text, maxWidth);
        pdf.text(lines, margin, yPosition);
        yPosition += lines.length * 7;
      }
    }

    console.log("✅ PDF generated successfully");

    return Buffer.from(pdf.output("arraybuffer"));
  } catch (error) {
    console.error("❌ PDF generation failed:", error);
    throw new Error(
      `PDF generation failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
