/**
 * Adjusts XSL stylesheets to fit A4 page size
 * Converts fixed pixel widths to responsive A4-compatible sizes
 */

// A4 dimensions at 96dpi
const A4_WIDTH_PX = 794; // 210mm at 96dpi
// const A4_HEIGHT_PX = 1123; // 297mm at 96dpi (not currently used)

// Common original widths in government documents
const COMMON_ORIGINAL_WIDTH = 640;

export function adjustXslForA4(xslContent: string): string {
  let adjustedXsl = xslContent;

  // Calculate scale factor
  const scaleFactor = A4_WIDTH_PX / COMMON_ORIGINAL_WIDTH;

  // Pattern to match width declarations in CSS
  // Matches: width: 640px, width:640px, etc.
  const widthPattern = /width\s*:\s*(\d+)px/gi;

  adjustedXsl = adjustedXsl.replace(widthPattern, (match, width) => {
    const originalWidth = parseInt(width, 10);
    const newWidth = Math.round(originalWidth * scaleFactor);
    return `width: ${newWidth}px`;
  });

  // Pattern to match height declarations
  const heightPattern = /height\s*:\s*(\d+)px/gi;

  adjustedXsl = adjustedXsl.replace(heightPattern, (match, height) => {
    const originalHeight = parseInt(height, 10);
    const newHeight = Math.round(originalHeight * scaleFactor);
    return `height: ${newHeight}px`;
  });

  // Pattern to match col element width attributes
  // Matches: <col width="250px" /> or <col width="250px">
  const colWidthPattern = /<col\s+([^>]*?)width="(\d+)px"([^>]*?)>/gi;

  adjustedXsl = adjustedXsl.replace(colWidthPattern, (match, before, width, after) => {
    const originalWidth = parseInt(width, 10);
    const newWidth = Math.round(originalWidth * scaleFactor);
    return `<col ${before}width="${newWidth}px"${after}>`;
  });

  // Add responsive page styles
  const pageStyles = `
    @page {
      size: A4;
      margin: 10mm;
    }
    @media print {
      body {
        width: 100%;
        max-width: ${A4_WIDTH_PX}px;
      }
    }
  `;

  // Insert page styles before closing </style> tag
  adjustedXsl = adjustedXsl.replace(
    /<\/style>/i,
    `${pageStyles}</style>`
  );

  return adjustedXsl;
}

/**
 * Adjusts font sizes proportionally
 */
export function adjustFontSizes(xslContent: string, scaleFactor = 1.2): string {
  let adjustedXsl = xslContent;

  // Match font-size declarations
  const fontSizePattern = /font-size\s*:\s*(\d+)px/gi;

  adjustedXsl = adjustedXsl.replace(fontSizePattern, (match, size) => {
    const originalSize = parseInt(size, 10);
    const newSize = Math.round(originalSize * scaleFactor);
    return `font-size: ${newSize}px`;
  });

  return adjustedXsl;
}

/**
 * Fix HTML tags in XSL to be XML-compliant
 */
export function fixHtmlTags(xslContent: string): string {
  let fixed = xslContent;

  // Fix self-closing META tags (make them XHTML compliant)
  // Replace <META ... /> with proper self-closing format
  fixed = fixed.replace(
    /<META\s+([^>]+?)(?:\s*\/)?>/gi,
    '<meta $1 />'
  );

  // Fix other common HTML tags that should be self-closing
  const selfClosingTags = ['br', 'hr', 'img', 'input', 'link'];
  selfClosingTags.forEach(tag => {
    const pattern = new RegExp(`<${tag}\\s+([^>]+?)(?:\\s*\\/)?>`,'gi');
    fixed = fixed.replace(pattern, `<${tag} $1 />`);
  });

  return fixed;
}

/**
 * Add text wrapping styles for pre tags to handle long text
 */
export function addPreTextWrapping(xslContent: string): string {
  let adjusted = xslContent;

  // Add CSS rule for pre.oshirase to enable text wrapping with Japanese text support
  const preStyles = `
    /* Japanese text wrapping for 機構からのお知らせ */
    pre.oshirase {
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      word-break: break-all !important;  /* Allow breaking anywhere in CJK text */
      overflow-wrap: anywhere !important; /* More aggressive wrapping */
      max-width: 310px !important;       /* 250px × 1.24 (scaled for A4) */
      overflow: hidden !important;        /* Prevent overflow */
      line-height: 1.3 !important;       /* Improve readability */
      font-size: 10px !important;        /* Appropriate font size */
    }

    /* Japanese text wrapping for 教示文 */
    pre.kyouji {
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      word-break: break-all !important;  /* Allow breaking anywhere in CJK text */
      overflow-wrap: anywhere !important; /* More aggressive wrapping */
      max-width: 710px !important;       /* 573px × 1.24 (scaled for A4) */
      max-height: 188px !important;      /* 152px × 1.24 (scaled for A4) */
      overflow: hidden !important;        /* Prevent overflow */
      line-height: 1.15 !important;      /* Tighter line spacing */
      font-size: 8px !important;         /* Smaller font to fit more text */
      letter-spacing: -0.3px !important; /* Slightly tighter spacing for better fit */
    }

    /* General pre tag handling */
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    /* Fixed table layout to respect width constraints */
    table {
      table-layout: fixed !important;
    }

    /* Table cells containing oshirase content */
    td:has(pre.oshirase), td > pre.oshirase {
      max-width: 310px !important;     /* 250px × 1.24 (scaled for A4) */
      word-break: break-all !important;
      overflow-wrap: anywhere !important;
    }

    /* Table cells containing kyouji content */
    td.kyouji, td:has(pre.kyouji) {
      max-width: 710px !important;     /* 573px × 1.24 (scaled for A4) */
      max-height: 188px !important;    /* 152px × 1.24 (scaled for A4) */
      word-break: break-all !important;
      overflow-wrap: anywhere !important;
      overflow: hidden !important;
      padding: 3px !important;
    }

    /* Fallback for browsers not supporting :has() */
    td {
      word-break: break-word;
      overflow-wrap: break-word;
    }
  `;

  // Insert before closing </style> tag
  adjusted = adjusted.replace(
    /<\/style>/i,
    `${preStyles}</style>`
  );

  return adjusted;
}

/**
 * Main function to optimize XSL for PDF output
 * Scales to A4 size and preserves original layout proportions
 */
export function optimizeXslForPdf(xslContent: string): string {
  // Step 1: Normalize HTML tag case FIRST to avoid case mismatch issues
  let optimized = xslContent;
  optimized = optimized.replace(/<(\/?)HTML>/gi, '<$1html>');
  optimized = optimized.replace(/<(\/?)HEAD>/gi, '<$1head>');
  optimized = optimized.replace(/<(\/?)BODY>/gi, '<$1body>');
  optimized = optimized.replace(/<(\/?)TITLE>/gi, '<$1title>');
  optimized = optimized.replace(/<(\/?)STYLE>/gi, '<$1style>');
  optimized = optimized.replace(/<(\/?)SCRIPT>/gi, '<$1script>');
  optimized = optimized.replace(/<(\/?)DIV>/gi, '<$1div>');
  optimized = optimized.replace(/<(\/?)TABLE>/gi, '<$1table>');
  optimized = optimized.replace(/<(\/?)TR>/gi, '<$1tr>');
  optimized = optimized.replace(/<(\/?)TD>/gi, '<$1td>');
  optimized = optimized.replace(/<(\/?)TH>/gi, '<$1th>');
  optimized = optimized.replace(/<(\/?)TBODY>/gi, '<$1tbody>');
  optimized = optimized.replace(/<(\/?)THEAD>/gi, '<$1thead>');
  optimized = optimized.replace(/<(\/?)SPAN>/gi, '<$1span>');
  optimized = optimized.replace(/<(\/?)PRE>/gi, '<$1pre>');
  optimized = optimized.replace(/<(\/?)FORM>/gi, '<$1form>');

  // Step 2: Fix HTML tags to be XML-compliant
  optimized = fixHtmlTags(optimized);

  // Step 3: Apply A4 scaling to fit the page properly
  optimized = adjustXslForA4(optimized);

  // Step 4: Add text wrapping for pre tags
  optimized = addPreTextWrapping(optimized);

  // Now add meta tags after <head>
  optimized = optimized.replace(
    /<head>/i,
    `<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />`
  );

  return optimized;
}
