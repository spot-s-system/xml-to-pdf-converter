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
      max-width: 250px !important;       /* Enforce maximum width */
      overflow: hidden !important;        /* Prevent overflow */
      line-height: 1.4 !important;       /* Improve readability */
      font-size: 12px !important;        /* Ensure consistent font size */
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
      max-width: 250px !important;
      word-break: break-all !important;
      overflow-wrap: anywhere !important;
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
 * Preserves original layout as designed for browser display
 */
export function optimizeXslForPdf(xslContent: string): string {
  // Step 1: Fix HTML tags to be XML-compliant
  let optimized = fixHtmlTags(xslContent);

  // Step 2: Add text wrapping for pre tags
  optimized = addPreTextWrapping(optimized);

  // Step 3: Normalize HTML tag case and enhance for PDF rendering
  // First convert all HTML tags to lowercase to avoid case mismatch issues
  optimized = optimized.replace(/<(\/?)HTML>/gi, '<$1html>');
  optimized = optimized.replace(/<(\/?)HEAD>/gi, '<$1head>');
  optimized = optimized.replace(/<(\/?)BODY>/gi, '<$1body>');
  optimized = optimized.replace(/<(\/?)TITLE>/gi, '<$1title>');

  // Now add meta tags after <head>
  optimized = optimized.replace(
    /<head>/i,
    `<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />`
  );

  return optimized;
}
