# ZIP構造パターン分析

## サンプルファイルから判明したZIP構造パターン

### パターン1: 標準的な公文書ZIP（kagami + 通知書）
```
公文書(002) (45).zip
├── 202508280447292844.xml    # 表紙XML（到達番号がファイル名）
├── kagami.xsl                 # 表紙用スタイルシート
├── 7130001.xml               # 標準報酬決定通知書XML
└── 7130001.xsl               # 標準報酬決定通知書用スタイルシート
```

**特徴:**
- 表紙（kagami）+ 1つの通知書
- XML/XSLペアが完全に揃っている
- 到達番号.xml が表紙のXMLファイル

---

### パターン2: 表紙のみ + PDF添付
```
公文書(002) (46).zip
├── 202508041922375694.xml    # 表紙XML（到達番号）
├── kagami.xsl                 # 表紙用スタイルシート
└── 7130001.pdf               # 通知書はPDF形式で添付
```

**特徴:**
- 表紙のみXML/XSL形式
- 通知書は既にPDF化されている
- PDF変換対象は表紙のみ

---

### パターン3: 複数通知書を含む
```
公文書(002) (49).zip
├── 202508202132142994.xml    # 表紙XML（到達番号）
├── kagami.xsl                 # 表紙用スタイルシート
├── 7130001.xml               # 標準報酬決定通知書XML
├── 7130001.xsl               # 標準報酬決定通知書用スタイルシート
├── 7200001.xml               # 70歳以上被用者通知書XML
└── 7200001.xsl               # 70歳以上被用者通知書用スタイルシート
```

**特徴:**
- 表紙 + 複数の通知書
- 各通知書がXML/XSLペアで含まれる
- PDFには全ての通知書を含める

---

### パターン4: ネストされたZIP構造（返戻票）
```
返戻のお知らせ (35).zip
├── 返戻のお知らせ.txt        # テキストファイル
└── 202508261727120754.zip    # 📦 ネストされたZIP
    └── 202508261727120754/
        ├── 202508261727120754.xml  # 表紙XML
        ├── kagami.xsl              # 表紙用スタイルシート
        ├── henrei.xml              # 返戻票XML
        └── henrei.xsl              # 返戻票用スタイルシート
```

**特徴:**
- ZIP内にさらにZIPが含まれる
- ネストされたZIPを展開して処理する必要がある
- 到達番号のフォルダ内にXML/XSLが格納

---

## 対応しているファイル種類

### XMLファイルパターン

| ファイル名 | 内容 | 用途 |
|-----------|------|------|
| `{到達番号}.xml` | 表紙（kagami） | 日本年金機構からのお知らせ |
| `7130001.xml` | 標準報酬決定通知書 | 健康保険・厚生年金保険被保険者標準報酬決定通知書 |
| `7200001.xml` | 70歳以上被用者通知書 | 健康保険被保険者適用除外承認申請書等 |
| `henrei.xml` | 返戻票 | 返戻のお知らせ |

### XSLファイルパターン

| ファイル名 | 対応XML | スタイルシート内容 |
|-----------|---------|------------------|
| `kagami.xsl` | {到達番号}.xml | 表紙レイアウト |
| `7130001.xsl` | 7130001.xml | 標準報酬決定通知書レイアウト（640px×940px） |
| `7200001.xsl` | 7200001.xml | 70歳以上被用者通知書レイアウト |
| `henrei.xsl` | henrei.xml | 返戻票レイアウト |

---

## 現在の処理ロジック

### 1. ZIP解凍処理
```typescript
// app/api/convert/route.ts

const zip = await JSZip.loadAsync(arrayBuffer);
const files: { [key: string]: string | Buffer } = {};

for (const [filename, zipEntry] of Object.entries(zip.files)) {
  if (zipEntry.dir) continue;

  // ネストされたZIPを検出
  if (filename.endsWith(".zip")) {
    const nestedZipData = await zipEntry.async("nodebuffer");
    const nestedZip = await JSZip.loadAsync(nestedZipData);

    // ネストされたZIPの中身を抽出
    for (const [nestedFilename, nestedEntry] of Object.entries(nestedZip.files)) {
      if (nestedFilename.endsWith(".xml") || nestedFilename.endsWith(".xsl")) {
        files[nestedFilename] = await nestedEntry.async("text");
      }
    }
  } else if (filename.endsWith(".xml") || filename.endsWith(".xsl")) {
    files[filename] = await zipEntry.async("text");
  }
}
```

### 2. ドキュメント識別・優先順位付け
```typescript
// lib/zip-to-pdf.ts

// 1. kagami.xml（表紙）を最優先
const kagamiXml = Object.keys(files).find(f =>
  f.includes("kagami") && f.endsWith(".xml")
);

// 2. 通知書を順番に処理
const notificationPatterns = [
  { pattern: /^7130001\.xml$/i, title: "標準報酬決定通知書" },
  { pattern: /^7200001\.xml$/i, title: "70歳以上被用者通知書" },
  { pattern: /^henrei\.xml$/i, title: "返戻票" },
];

// 3. その他のXML/XSLペアも処理
```

---

## 処理フロー

```
ZIPファイル受信
    ↓
┌───────────────────────┐
│ ZIP解凍処理           │
├───────────────────────┤
│ - ルートレベル        │
│ - ネストされたZIP     │
│   (再帰的に処理)      │
└─────────┬─────────────┘
          ↓
┌───────────────────────┐
│ファイル抽出           │
├───────────────────────┤
│ ✓ *.xml               │
│ ✓ *.xsl               │
│ ✗ *.pdf (スキップ)    │
│ ✗ *.txt (スキップ)    │
└─────────┬─────────────┘
          ↓
┌───────────────────────┐
│ドキュメント識別       │
├───────────────────────┤
│ 1. kagami.xml/xsl     │
│ 2. 7130001.xml/xsl    │
│ 3. 7200001.xml/xsl    │
│ 4. henrei.xml/xsl     │
│ 5. その他ペア         │
└─────────┬─────────────┘
          ↓
┌───────────────────────┐
│各ドキュメント変換     │
├───────────────────────┤
│ XML + XSL → HTML      │
│ (XSLT変換)            │
└─────────┬─────────────┘
          ↓
┌───────────────────────┐
│HTML結合               │
├───────────────────────┤
│ <document-container>  │
│ <page-break>          │
└─────────┬─────────────┘
          ↓
┌───────────────────────┐
│PDF生成                │
├───────────────────────┤
│ Puppeteer             │
│ A4, 5mm/10mm margins  │
└─────────┬─────────────┘
          ↓
     PDF完成
```

---

## 対応状況

| パターン | 対応状況 | 備考 |
|---------|---------|------|
| ✅ 標準的な公文書 | 対応済み | kagami + 通知書 |
| ✅ 表紙のみ | 対応済み | PDFファイルは無視 |
| ✅ 複数通知書 | 対応済み | 全て1つのPDFに結合 |
| ✅ ネストされたZIP | 対応済み | 再帰的に展開 |
| ⚠️  XSL未添付 | 未対応 | XMLのみの場合はエラー |
| ⚠️  不明なXML形式 | 部分対応 | ペアがあれば処理可能 |

---

## 今後の拡張性

### 想定される新しいパターン

1. **複数階層のネストZIP**
   - 現在は1階層のみ対応
   - 3階層以上のネストは未テスト

2. **カスタム通知書**
   - 7130001, 7200001, henrei 以外の新形式
   - パターンマッチングで対応可能

3. **マルチバイトファイル名**
   - 日本語ファイル名のエンコーディング問題
   - 現在は問題なし

4. **大容量ZIP**
   - 100MB超のZIPファイル
   - メモリ制限に注意が必要
