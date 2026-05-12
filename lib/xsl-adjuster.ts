/**
 * Adjusts XSL stylesheets to fit A4 page size
 * Converts fixed pixel widths to responsive A4-compatible sizes
 */

// A4 dimensions at 96dpi
// 公文書XSLは width=640px のレイアウトで組まれており、A4 (約 794px @ 96dpi、
// 5mmマージン後 ~756px) に対しては余裕がある。以前は 640 → 720px (1.125倍) に
// 拡大して横幅を埋めていたが、これによりテーブル全体の縦サイズも拡大して
// A4 1ページに収まりきらなくなり、XSL 内の <br class="kaipage" /> +
// page-break-after:always と相まって、被保険者1人あたり 1ページ余分に空白
// ページが挟まる不具合が発生していた（Edge の Print to PDF では元の 640px
// レイアウトのまま描画されるので発生しない）。
// 拡大しない (scaleFactor = 1.0) ことで Edge と同等のレイアウトに揃える。
const A4_WIDTH_PX = 640;
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

  // A4 用の @page と body を設定。
  // 元 XSL の outline テーブルは width=640px のまま描画され、内側の
  //   table width="100%" → td align="center"
  // で中央寄せされる（Edge の Print to PDF と同じ挙動）。
  // body に max-width を付けると左寄せに固定されてしまうため付けない。
  //
  // 外枠 (.outline) を 640px → 720px に拡張:
  //   元 XSL は `table.outline { width: 640px }` 指定で、内側の被保険者
  //   データ表 (col width 合計が ~600px) が cellpadding="20px" 内に
  //   ほぼ目一杯入り、外枠の右辺と内部表の右辺が見た目上重なる状態。
  //   外枠幅を 80px 広げて 720px にすることで、内部表の左右に約 20px の
  //   余白が生まれ、視覚的な重なりが解消される (ユーザー要望: 中央の表は
  //   小さくせず外枠を大きく)。
  //   高さは元のまま (height: 940px) なので、縦方向のページ量は変わらず
  //   通知書本体 + 教示文 の 2 ページ構成を維持し、白紙ページが挟まる
  //   余地はない。720px は A4 印刷可能領域 756px (5mm マージン) に収まる。
  const pageStyles = `
    @page {
      size: A4;
      margin: 5mm;
    }
    @media print {
      body {
        margin: 0;
      }
    }
    /* 外枠 .outline テーブル自体を横方向に拡張 */
    table.outline {
      width: 720px !important;
    }
  `;

  // Insert page styles before closing style tag (handle both cases)
  if (adjustedXsl.match(/<\/STYLE>/i)) {
    adjustedXsl = adjustedXsl.replace(
      /<\/STYLE>/i,
      `${pageStyles}</style>`
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
    // 包括的なパターン: <br />, <br/>, <br>, <br attr="...">, <br attr="..." />
    // 全てを統一フォーマットに: <br /> または <br attr="..." />
    // [^/>] を使って属性が / で終わらないようにする
    const pattern = new RegExp(`<${tag}(\\s+[^/>][^>]*?)?\\s*\\/?>`, 'gi');
    fixed = fixed.replace(pattern, (_match, attrs) => {
      if (attrs && attrs.trim()) {
        return `<${tag}${attrs} />`;
      } else {
        return `<${tag} />`;
      }
    });
  });

  return fixed;
}

/**
 * Add text wrapping styles for pre tags
 *
 * 設計方針:
 *  元の XSL は Safari (Webkit) 限定で `pre.oshirase { white-space: break-spaces }` を
 *  指定して右上「機構からのお知らせ」枠の改行を制御している。Chromium ベースの
 *  Puppeteer はこのメディアクエリにヒットしないため、明示的に同じ挙動を付与する。
 *
 *  以前のバージョンはここで `word-break: break-all / overflow-wrap: anywhere /
 *  max-width: 281px / overflow: hidden / font-size: 10px` 等を強制していたが、
 *  これらは元 XSL の `font-size: 7pt; line-break: anywhere; word-wrap: break-word`
 *  の意図を上書きし、(a) 右上枠の文章が文字単位でブツ切りになる、(b) セル高さが
 *  伸びて A4 1ページ目があふれ、kyoji の page-break-after と相まって余分な空白
 *  ページが挟まる、という2つの不具合を引き起こしていた（Edge の標準PDF出力では
 *  発生しない）。
 *
 *  ここでは Edge と同等の見た目になるよう、元 XSL の指定を尊重し、
 *  Chromium で `break-spaces` が効くようにする最小限の補強のみ行う。
 */
export function addPreTextWrapping(xslContent: string): string {
  let adjusted = xslContent;

  // 注意: ここに挿入するテキストは XSL の <style> 要素の中に入る。XSL を XML として
  // パースする際、<style> は CDATA 扱いされないため、CSS コメント内に "<col" のような
  // タグ風文字列を書くと XML パーサが開始タグと誤解釈してパース失敗する。
  // コメント内では HTML タグを書かないこと。
  const preStyles = `
    /* Chromium で break-spaces を有効化 (元 XSL は Webkit 限定指定のみ) */
    pre.oshirase {
      white-space: break-spaces;
    }

    /* 元 XSL の col width 指定を尊重する */
    table {
      table-layout: fixed;
    }
  `;

  if (adjusted.match(/<\/STYLE>/i)) {
    adjusted = adjusted.replace(
      /<\/STYLE>/i,
      `${preStyles}</style>`
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
