/**
 * Adjusts XSL stylesheets to fit A4 page size
 * Converts fixed pixel widths to responsive A4-compatible sizes
 */

// A4 dimensions at 96dpi
// Adjusted to account for PDF margins (5mm left + 5mm right = ~38px)
// Further reduced to ensure content doesn't get cut off on the right
const A4_WIDTH_PX = 720; // Further reduced from 740 to provide even more margin
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
      margin: 5mm;
    }
    @media print {
      body {
        width: 100%;
        max-width: ${A4_WIDTH_PX}px;
        padding-right: 15px; /* Additional right padding - increased */
      }
    }
  `;

  // Insert page styles before closing style tag (handle both cases)
  if (adjustedXsl.match(/<\/STYLE>/i)) {
    adjustedXsl = adjustedXsl.replace(
      /<\/STYLE>/i,
      `${pageStyles}</STYLE>`
    );
  } else {
    adjustedXsl = adjustedXsl.replace(
      /<\/style>/i,
      `${pageStyles}</style>`
    );
  }

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
      max-width: 281px !important;       /* 250px × 1.125 (scaled for A4 with even more margin) */
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
      max-width: 645px !important;       /* 573px × 1.125 (scaled for A4 with even more margin) */
      max-height: 171px !important;      /* 152px × 1.125 (scaled for A4 with even more margin) */
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
      max-width: 281px !important;     /* 250px × 1.125 (scaled for A4 with even more margin) */
      word-break: break-all !important;
      overflow-wrap: anywhere !important;
    }

    /* Table cells containing kyouji content */
    td.kyouji, td:has(pre.kyouji) {
      max-width: 645px !important;     /* 573px × 1.125 (scaled for A4 with even more margin) */
      max-height: 171px !important;    /* 152px × 1.125 (scaled for A4 with even more margin) */
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

  // Insert before closing style tag (handle both cases)
  if (adjusted.match(/<\/STYLE>/i)) {
    adjusted = adjusted.replace(
      /<\/STYLE>/i,
      `${preStyles}</STYLE>`
    );
  } else {
    adjusted = adjusted.replace(
      /<\/style>/i,
      `${preStyles}</style>`
    );
  }

  return adjusted;
}

/**
 * Normalize all HTML tag case to lowercase for XML compliance
 */
function normalizeAllHtmlTags(content: string): string {
  // 包括的なHTMLタグのリスト
  const htmlTags = [
    'html', 'head', 'body', 'title', 'style', 'script', 'meta', 'link',
    'div', 'span', 'p', 'a', 'img', 'br', 'hr',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'form', 'input', 'textarea', 'button', 'select', 'option', 'label', 'fieldset', 'legend',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'del', 'ins', 'sub', 'sup',
    'pre', 'code', 'blockquote', 'cite', 'q',
    'iframe', 'embed', 'object', 'param', 'video', 'audio', 'source', 'track', 'canvas',
    'header', 'footer', 'nav', 'section', 'article', 'aside', 'main', 'figure', 'figcaption',
    'details', 'summary', 'dialog', 'menu', 'menuitem'
  ];

  let normalized = content;

  // 各タグについて、大文字小文字を問わず小文字に統一
  // より確実なマッチングのため、エスケープして正規表現を作成
  for (const tag of htmlTags) {
    // 開始タグ: <TAG>, <TAG >, <TAG attr="...">
    // 大文字小文字を区別しない全体マッチング
    const openTagPattern = new RegExp(`<(${tag})(\\s|>|/)`, 'gi');
    const closeTagPattern = new RegExp(`</(${tag})>`, 'gi');

    normalized = normalized.replace(openTagPattern, (_fullMatch, _tagName, after) => {
      return `<${tag.toLowerCase()}${after}`;
    });

    normalized = normalized.replace(closeTagPattern, () => {
      return `</${tag.toLowerCase()}>`;
    });
  }

  return normalized;
}

/**
 * Main function to optimize XSL for PDF output
 * Scales to A4 size and preserves original layout proportions
 */
export function optimizeXslForPdf(xslContent: string): string {
  let optimized = xslContent;

  // Step 1: Fix HTML tags to be XML-compliant BEFORE normalization
  optimized = fixHtmlTags(optimized);

  // Step 2: Normalize ALL HTML tags to lowercase (包括的な正規化)
  optimized = normalizeAllHtmlTags(optimized);

  // Step 3: Apply A4 scaling to fit the page properly
  optimized = adjustXslForA4(optimized);

  // Step 4: Add text wrapping for pre tags
  optimized = addPreTextWrapping(optimized);

  // Step 5: Add meta tags after <head>
  optimized = optimized.replace(
    /<head>/i,
    `<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />`
  );

  return optimized;
}
