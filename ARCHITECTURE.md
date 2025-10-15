# XML to PDF Converter - アーキテクチャ概要

## プロジェクト構成

```
xml-to-pdf-converter/
├── app/                          # Next.js App Router
│   ├── api/                      # APIエンドポイント
│   │   ├── convert/route.ts      # ⭐ メインAPI: ZIP→PDF変換
│   │   ├── health/route.ts       # ヘルスチェック・メモリ監視
│   │   └── test-chromium/route.ts # Chromiumテスト用
│   ├── layout.tsx                # アプリ全体レイアウト
│   └── page.tsx                  # トップページ（アップロードUI）
│
├── lib/                          # コアロジック
│   ├── zip-to-pdf.ts            # ⭐ オーケストレーター
│   ├── bulk-zip-processor.ts    # ⭐ 一括ZIP処理（複数フォルダ対応）
│   ├── xslt-processor.ts        # ⭐ XML+XSL→HTML変換
│   ├── pdf-generator.ts         # ⭐ HTML→PDF生成
│   ├── xsl-adjuster.ts          # XSLスタイルシート最適化
│   ├── browser-pool.ts          # ⭐ Puppeteerブラウザプール管理
│   ├── procedure-detector.ts    # 手続き種別判定
│   ├── xml-info-extractor.ts    # XML情報抽出
│   ├── pdf-naming.ts            # PDFファイル名生成
│   ├── logger.ts                # リアルタイムログ出力
│   └── utils.ts                 # ユーティリティ関数
│
├── components/                   # UIコンポーネント
│   ├── file-dropzone.tsx        # ファイルアップロードUI
│   └── ui/                      # shadcn/ui コンポーネント
│       ├── button.tsx
│       ├── card.tsx
│       └── progress.tsx
│
├── sample/                       # テスト用サンプルファイル
│   └── *.zip                    # 公文書ZIPファイル
│
├── Dockerfile                    # Docker本番環境設定
├── render.yaml                   # Renderデプロイ設定
├── package.json                  # 依存関係定義
├── tsconfig.json                 # TypeScript設定
└── next.config.ts                # Next.js設定
```

---

## PDF変換フロー

### 1. ユーザーアクション（フロントエンド）
```
app/page.tsx (UIコンポーネント)
    ↓
    ZIPファイルをアップロード
    ↓
    POST /api/convert
```

### 2. APIエンドポイント
```typescript
// app/api/convert/route.ts
export async function POST(request: NextRequest) {
  // 1. ZIPファイル取得
  const file = formData.get("file") as File;

  // 2. ZIP解凍（ネストされたZIPも対応）
  const zip = await JSZip.loadAsync(arrayBuffer);

  // 3. XML/XSLファイル抽出
  const files: { [key: string]: string | Buffer } = {};
  // - kagami.xml/xsl (表紙)
  // - 7130001.xml/xsl (標準報酬決定通知書)
  // - 7200001.xml/xsl (70歳以上被用者通知書)
  // - henrei.xml/xsl (返戻票)

  // 4. PDF変換実行
  const pdfBuffer = await convertZipToPdf(files);

  // 5. PDFをレスポンスとして返す
  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
    },
  });
}
```

### 3. オーケストレーター（変換調整）
```typescript
// lib/zip-to-pdf.ts
export async function convertZipToPdf(files: ExtractedFiles): Promise<Buffer> {
  // 1. ドキュメント識別・順序付け
  const documentGroups: DocumentGroup[] = [];

  // 優先順位:
  // 1) kagami.xml (表紙)
  // 2) 7130001.xml (標準報酬決定通知書)
  // 3) 7200001.xml (70歳以上被用者通知書)
  // 4) henrei.xml (返戻票)
  // 5) その他XML/XSLペア

  // 2. 各ドキュメントをHTML変換
  for (const group of documentGroups) {
    const optimizedXsl = optimizeXslForPdf(group.xslContent);
    const html = await applyXsltTransformation(
      group.mainXmlContent,
      optimizedXsl
    );
    htmlPages.push(html);
  }

  // 3. 全HTMLを結合
  const combinedHtml = `
    <!DOCTYPE html>
    <html>
      <head>...</head>
      <body>
        ${htmlPages.map(html =>
          `<div class="document-container">${html}</div>`
        ).join('<div class="page-break"></div>')}
      </body>
    </html>
  `;

  // 4. PDF生成
  const pdfBuffer = await generatePdfFromHtml(combinedHtml);
  return pdfBuffer;
}
```

### 4. XSLT変換（XML→HTML）
```typescript
// lib/xslt-processor.ts
export async function applyXsltTransformation(
  xmlContent: string,
  xslContent: string
): Promise<string> {
  // 1. ブラウザインスタンス取得（プール管理）
  const browser = await getBrowser();
  const page = await browser.newPage();

  // 2. HTMLページ作成（XSLTProcessor使用）
  const transformHtml = `
    <script>
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
      const xslDoc = parser.parseFromString(xslContent, "text/xml");

      const xsltProcessor = new XSLTProcessor();
      xsltProcessor.importStylesheet(xslDoc);

      const resultDoc = xsltProcessor.transformToFragment(xmlDoc, document);
      document.getElementById("result").appendChild(resultDoc);
    </script>
  `;

  // 3. ブラウザで実行・HTML取得
  await page.setContent(transformHtml, { waitUntil: "domcontentloaded" });
  const transformedHtml = await page.evaluate(() =>
    document.getElementById("result").innerHTML
  );

  // 4. ページクローズ（ブラウザは再利用）
  await page.close();
  return transformedHtml;
}
```

### 5. PDF生成（HTML→PDF）
```typescript
// lib/pdf-generator.ts
export async function generatePdfFromHtml(
  htmlContent: string
): Promise<Buffer> {
  // 1. ブラウザインスタンス取得（プール管理）
  const browser = await getBrowser();
  const page = await browser.newPage();

  // 2. ビューポート設定
  await page.setViewport({ width: 1200, height: 1600 });

  // 3. HTMLコンテンツ読み込み
  await page.setContent(htmlContent, { waitUntil: "domcontentloaded" });

  // 4. レンダリング完了待機
  await page.waitForFunction(() => window.scalingComplete === true);

  // 5. PDF生成
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

  // 6. ページクローズ
  await page.close();
  return Buffer.from(pdfBuffer);
}
```

### 6. ブラウザプール管理（パフォーマンス最適化）
```typescript
// lib/browser-pool.ts
let browserInstance: Browser | null = null;
let requestCount = 0;
const MAX_REQUESTS_PER_BROWSER = 50; // 環境変数で設定可能

export async function getBrowser(): Promise<Browser> {
  // メモリリーク防止: N回リクエスト後に再起動
  if (browserInstance && requestCount >= MAX_REQUESTS_PER_BROWSER) {
    await closeBrowser();
  }

  // ブラウザ起動（初回のみ）
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    requestCount = 0;
  }

  requestCount++;
  return browserInstance;
}
```

---

## データフロー図

```
┌─────────────┐
│ User        │
│ (Browser)   │
└──────┬──────┘
       │ 1. Upload ZIP
       ▼
┌─────────────────────────────────────────┐
│ app/page.tsx                            │
│ - File dropzone UI                      │
│ - Progress bar                          │
└──────┬──────────────────────────────────┘
       │ 2. POST /api/convert
       ▼
┌─────────────────────────────────────────┐
│ app/api/convert/route.ts                │
│ - Receive ZIP file                      │
│ - Extract XML/XSL files                 │
│ - Handle nested ZIPs                    │
└──────┬──────────────────────────────────┘
       │ 3. convertZipToPdf(files)
       ▼
┌─────────────────────────────────────────┐
│ lib/zip-to-pdf.ts                       │
│ - Identify document types               │
│ - Order documents (kagami first)        │
│ - Loop through each document            │
└──────┬──────────────────────────────────┘
       │ 4. For each XML/XSL pair
       ▼
┌─────────────────────────────────────────┐
│ lib/xsl-adjuster.ts                     │
│ - Fix HTML tags (XHTML compliance)      │
│ - Add text wrapping styles              │
└──────┬──────────────────────────────────┘
       │ 5. optimizedXsl
       ▼
┌─────────────────────────────────────────┐
│ lib/xslt-processor.ts                   │
│ ┌───────────────────────────────────┐   │
│ │ lib/browser-pool.ts               │   │
│ │ - Get/reuse browser instance      │   │
│ └───────────────────────────────────┘   │
│ - Create new page                       │
│ - Load XML + XSL in browser             │
│ - Execute XSLTProcessor                 │
│ - Extract transformed HTML              │
└──────┬──────────────────────────────────┘
       │ 6. HTML array
       ▼
┌─────────────────────────────────────────┐
│ lib/zip-to-pdf.ts                       │
│ - Combine all HTMLs                     │
│ - Add page breaks between docs          │
│ - Wrap in document containers           │
└──────┬──────────────────────────────────┘
       │ 7. combinedHtml
       ▼
┌─────────────────────────────────────────┐
│ lib/pdf-generator.ts                    │
│ ┌───────────────────────────────────┐   │
│ │ lib/browser-pool.ts               │   │
│ │ - Get/reuse browser instance      │   │
│ └───────────────────────────────────┘   │
│ - Create new page                       │
│ - Load HTML in browser                  │
│ - Wait for rendering complete           │
│ - Generate PDF                          │
└──────┬──────────────────────────────────┘
       │ 8. PDF Buffer
       ▼
┌─────────────────────────────────────────┐
│ app/api/convert/route.ts                │
│ - Return PDF as response                │
│ - Set Content-Disposition header        │
└──────┬──────────────────────────────────┘
       │ 9. Download PDF
       ▼
┌─────────────┐
│ User        │
│ (Browser)   │
└─────────────┘
```

---

## 重要なポイント

### 1. ブラウザプール管理
- **なぜ**: Puppeteer起動コストが高い（2-3秒）
- **どうやって**: 1つのブラウザインスタンスを複数リクエストで再利用
- **メモリ対策**: 30-50リクエストごとに自動再起動

### 2. XSLレイアウト保持
- **元の設計**: 640px×940px（ブラウザ表示用）
- **方針**: 元のレイアウトを尊重し、無理にA4に詰め込まない
- **結果**: 複数ページに自然に分割

### 3. パフォーマンス最適化
- `waitUntil: "networkidle0"` → `"domcontentloaded"` (高速化)
- 不要な待機時間削除
- ページクローズのみ（ブラウザは残す）

### 4. メモリ監視
- `/api/health` エンドポイントで監視可能
- RSS、ヒープ使用量、ブラウザリクエスト数を表示

---

## パフォーマンス指標

| 段階 | 初回 | 2回目以降 |
|------|------|-----------|
| **以前** | 5.8秒 | 4.3秒 |
| **現在** | 2.2秒 | 0.6秒 |
| **改善率** | 62% | 86% |

### メモリ使用量
- アイドル時: ~100MB
- 変換中: ~150-200MB
- Render free tier: 512MB（十分な余裕）

---

## 一括ZIP処理（Bulk ZIP Processor）

### 概要
`lib/bulk-zip-processor.ts` は複数フォルダを含むZIPファイルを一括処理し、各フォルダごとにPDF変換を実行する機能を提供します。

### フォルダ構造パターン

```
bulk-upload.zip
├── 0001_会社名_被保険者名_手続き種別/
│   ├── XML files...
│   ├── XSL files...
│   └── nested.zip (ネストされたZIPも対応)
├── 0002_会社名_被保険者名_手続き種別/
│   ├── XML files...
│   └── existing.pdf (既存PDFはそのまま保持)
└── 0003_会社名_被保険者名_[雇保]資格喪失(離職票交付あり)_.../
    ├── XML files...
    └── 2501793096_雇用保険被保険者資格喪失確認通知書.pdf
```

### 処理フロー

```typescript
// 1. ZIP解凍
const extractPath = await extractZipFile(zipBuffer);

// 2. フォルダ構造分析
const folders = await analyzeFolderStructure(extractPath);
// - 4桁番号で始まるフォルダを検出
// - ネストされたZIPを展開
// - XML/XSLペアを識別
// - その他のファイル（PDF等）をリストアップ

// 3. 各フォルダを処理
const results = await processFolders(folders);
// - XML/XSLペアをPDF化
// - 既存ファイルを保持

// 4. 結果ZIPを作成
const resultZip = await createResultZip(results, extractPath);
// - 生成されたPDFを追加
// - 元のXML/XSLファイルをコピー
// - その他のファイルをコピー（PDFリネーム処理適用）
```

### PDFリネーム機能

雇用保険の離職票交付が伴う手続きでは、既存のPDFファイル（数字で始まるもの）を被保険者名でリネームします。

#### 対象条件
- フォルダ名に「**離職票交付あり**」が含まれている
- ファイル名が数字で始まる `.pdf` ファイル

#### リネーム例

**フォルダ名:**
```
0013_株式会社1SEC_川村 夏菜_[雇保]資格喪失(離職票交付あり)_...
```

**リネーム処理:**
```
変更前: 2501793096_雇用保険被保険者資格喪失確認通知書.pdf
変更後: 川村夏菜_雇用保険被保険者資格喪失確認通知書.pdf
```

#### 実装詳細

```typescript
// フォルダ名から被保険者名を抽出
function extractInsurerNameFromFolderName(folderName: string): string | null {
  // 「離職票交付あり」が含まれていない場合は null
  if (!folderName.includes('離職票交付あり')) {
    return null;
  }

  // パターン: 4桁の番号_会社名_被保険者名_...
  const match = folderName.match(/^\d{4}_[^_]+_([^_]+)_/);
  if (match) {
    // 被保険者名を抽出し、スペースを削除
    return match[1].replace(/\s+/g, '');
  }
  return null;
}

// PDFファイル名を必要に応じてリネーム
function renamePdfIfNeeded(fileName: string, insurerName: string | null): string {
  if (!fileName.toLowerCase().endsWith('.pdf') || !insurerName) {
    return fileName;
  }

  // 数字で始まるPDFファイルのみリネーム対象
  const match = fileName.match(/^\d+_(.+)$/);
  if (match) {
    return `${insurerName}_${match[1]}`;
  }

  return fileName;
}
```

#### 重要な設計方針

1. **既存PDF生成ロジックには影響なし**
   - 新規生成されるPDFは従来通りの命名規則
   - リネーム処理は `otherFiles`（既存ファイル）にのみ適用

2. **条件付き実行**
   - 「離職票交付あり」を含むフォルダのみ処理
   - その他のフォルダでは既存のファイル名を保持

3. **ファイルパターンマッチング**
   - 数字で始まるPDFのみが対象
   - それ以外のPDFファイルは変更されない

### ネストされたZIP対応

```typescript
// ネストされたZIPを検出
const nestedZips = files.filter(file =>
  path.extname(file).toLowerCase() === '.zip'
);

for (const nestedZipFile of nestedZips) {
  // 1. ネストされたZIPを読み込み
  const nestedZipBuffer = await fs.readFile(nestedZipPath);
  const nestedZip = await JSZip.loadAsync(nestedZipBuffer);

  // 2. XML/XSLファイルを一時ディレクトリに展開
  const tempNestedPath = await fs.mkdtemp(path.join(tmpdir(), 'nested-'));

  // 3. ドキュメントペアを検出
  const nestedDocs = await detectDocumentPairs(tempNestedPath, nestedFiles);

  // 4. 通常のドキュメントと結合
  extractedDocuments.push(...nestedDocs);
}
```

### リアルタイムログ出力

一括処理中の進捗状況はリアルタイムで出力されます：

```typescript
import { log, logIndent, logError, createProgressBar } from './logger';

// フォルダ処理ログ
log(`${progress} Processing folder ${folderNumber}/${totalFolders}`, '📁');
logIndent(truncateFileName(folder.folderName, 60), 1);

// ドキュメント処理ログ
logIndent(`📄 Document ${docIndex + 1}/${folder.documents.length}`, 2);

// 完了ログ
logIndent(`✅ Completed: ${pdfs.length} PDFs generated (${duration})`, 1);
```

### データ構造

```typescript
export interface DocumentPair {
  type: 'kagami' | 'notification';
  xmlPath: string;
  xslPath: string;
  xmlFileName: string;
  xslFileName: string;
}

export interface FolderStructure {
  folderName: string;
  folderPath: string;
  documents: DocumentPair[];
  xmlXslFiles: string[];  // 元のXML/XSLファイル
  otherFiles: string[];   // PDF、TXT等のその他ファイル
}

export interface ProcessedFolder {
  folderName: string;
  success: boolean;
  pdfs?: GeneratedPdf[];
  xmlXslFiles?: string[];
  otherFiles?: string[];
  error?: string;
}
```

### エラーハンドリング

変換失敗時は、該当フォルダにエラーファイルを配置：

```typescript
if (!folder.success) {
  const errorMessage = `PDFの変換中にエラーが発生しました

フォルダ: ${folder.folderName}
エラー内容: ${folder.error}

対処方法:
1. 元のZIPファイルの内容を確認してください
2. 不足しているファイルを追加して再度アップロードしてください`;

  zip.file(`${folderPrefix}変換エラー.txt`, errorMessage);
}
```

### API エンドポイント

一括処理は `/api/bulk-convert` エンドポイントで提供：

```typescript
// app/api/bulk-convert/route.ts
export async function POST(request: NextRequest) {
  // 1. ZIPファイル受信
  const formData = await request.formData();
  const file = formData.get("file") as File;

  // 2. 一括処理実行
  const extractPath = await extractZipFile(zipBuffer);
  const folders = await analyzeFolderStructure(extractPath);
  const results = await processFolders(folders);
  const resultZip = await createResultZip(results, extractPath);

  // 3. クリーンアップ
  await cleanupTempDirectory(extractPath);

  // 4. 結果ZIPを返却
  return new NextResponse(resultZip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodedFilename}"`,
    },
  });
}
```
