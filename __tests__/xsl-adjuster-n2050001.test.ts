/**
 * N2050001（育児休業終了時月額変更 → 標準報酬改定通知書）専用レイアウト補正の回帰テスト
 *
 * この XSL は外枠 width:940px の横長レイアウトで、640px 系向けの汎用CSS
 * （outline を 720px に固定 / table-layout:fixed）をそのまま当てると
 * 「決定後の標準報酬月額」行の (厚年) 金額が改行される。専用補正が
 * ・N2050001 の XSL にだけ効くこと
 * ・汎用CSS より後に挿入され上書きが効くこと
 * を担保する。
 */
import { describe, it, expect } from 'vitest';
import { adjustForN2050001, optimizeXslForPdf } from '@/lib/xsl-adjuster';

const xslWith = (marker: string) =>
  `<?xml version="1.0"?><xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">` +
  `<xsl:template match="/"><html><head><style>table.outline{width:940px;height:640px}</style></head>` +
  `<body/></html></xsl:template>` +
  `<xsl:template match="${marker}"><table class="outline"/></xsl:template></xsl:stylesheet>`;

describe('adjustForN2050001', () => {
  it('N2050001 を含む XSL には補正CSS（zoom / table-layout:auto / 940px上書き）を挿入する', () => {
    const out = adjustForN2050001(xslWith('N2050001'));
    expect(out).toMatch(/zoom:\s*0\.78/);
    expect(out).toMatch(/table-layout:\s*auto/);
    expect(out).toMatch(/table\.outline\s*\{[^}]*width:\s*940px\s*!important/);
  });

  it('N2050001 を含まない XSL は素通し（変更しない）', () => {
    const input = xslWith('N7140001');
    expect(adjustForN2050001(input)).toBe(input);
  });

  it('optimizeXslForPdf 経由では汎用の 720px 指定より後に 940px 上書きが挿入される', () => {
    const out = optimizeXslForPdf(xslWith('N2050001'));
    const idx720 = out.indexOf('720px');
    const idx940 = out.lastIndexOf('940px !important');
    expect(idx720).toBeGreaterThanOrEqual(0); // 汎用CSSの 720px 指定が存在
    expect(idx940).toBeGreaterThan(idx720);   // 専用補正がそれより後（=CSS上書きが有効）
  });
});
