# XML to PDF Converter

公文書ZIPファイル（XML/XSL形式）をPDFに変換するWebアプリケーション

## 概要

このアプリケーションは、日本の公的機関で使用される電子申請ファイル（ZIP形式）を受け取り、内部のXML/XSLドキュメントをPDFに変換します。

### 主な機能

- ✅ ZIPファイルのドラッグ&ドロップアップロード
- ✅ ネストされたZIPファイルの自動展開
- ✅ 複数被保険者を1つのPDFにまとめる
- ✅ 日本語ファイル名自動生成（{名前}様{他N名}_{通知書名}.pdf）
- ✅ XSLT変換によるXML→HTML変換
- ✅ Puppeteerを使用したPDF生成
- ✅ 日本語フォント完全対応
- ✅ A4サイズ最適化
- ✅ ブラウザプールによる高速化（2回目以降0.6秒）

### 対応ドキュメント形式

| 通知書番号 | 通知書名 | 出力ファイル名例 |
|-----------|---------|-----------------|
| 7130001 | 健康保険・厚生年金保険被保険者標準報酬決定通知書 | 山田太郎様他1名_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf |
| 7200001 | 厚生年金保険70歳以上被用者標準報酬月額相当額決定のお知らせ | 山田太郎様他1名_厚生年金保険70歳以上被用者標準報酬月額相当額決定のお知らせ.pdf |
| henrei | 返戻のお知らせ | 山田太郎様_返戻のお知らせ.pdf |
| kagami | 日本年金機構からのお知らせ | 田中一郎様_日本年金機構からのお知らせ.pdf |

## 開発環境のセットアップ

### 必要な環境

- Node.js 20以上
- npm または yarn

### ローカル開発（推奨）

Puppeteerを使用するため、開発環境でも必要な依存関係をインストールする必要があります。

```bash
# 依存関係のインストール
npm install

# Puppeteerブラウザのインストール（初回のみ）
npx puppeteer browsers install chrome

# 開発サーバーの起動
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてアプリケーションを確認できます。

### Docker開発環境

本番環境と同じ環境で開発・テストする場合はDockerを使用します。

```bash
# Dockerイメージのビルド
docker build -t xml-to-pdf-converter .

# コンテナの起動
docker run -p 3000:3000 xml-to-pdf-converter
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてアプリケーションを確認できます。

### 開発時のヒント

- ローカル開発では `npm run dev` が最も高速（Turbopack使用）
- PDF生成のテストは `/api/test-chromium` エンドポイントでChromiumの動作確認が可能
- 日本語フォントの表示を確認する場合はDockerコンテナでのテストを推奨

## プロジェクト構成

```
.
├── app/
│   ├── api/convert/route.ts      # ZIP→PDF変換APIエンドポイント
│   ├── api/test-chromium/route.ts # Chromiumテストエンドポイント
│   ├── page.tsx                   # メインUIページ
│   └── layout.tsx                 # アプリケーションレイアウト
├── lib/
│   ├── zip-to-pdf.ts             # ZIP処理とドキュメント構成
│   ├── xslt-processor.ts         # XSLT変換処理
│   ├── xsl-adjuster.ts           # XSLスタイルシートA4最適化
│   ├── pdf-generator.ts          # Puppeteer PDF生成
│   └── utils.ts                  # ユーティリティ関数
├── components/
│   ├── file-dropzone.tsx         # ファイルアップロードUI
│   └── ui/                       # shadcn/ui コンポーネント
├── Dockerfile                     # 本番環境コンテナ定義
└── render.yaml                    # Renderデプロイ設定
```

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router)
- **UI**: React 19 + Tailwind CSS + shadcn/ui
- **PDF生成**: Puppeteer
- **XSLT処理**: ブラウザネイティブXSLTProcessor
- **デプロイ**: Docker (Render対応)

## ビルドとデプロイ

### ローカルビルド

```bash
# プロダクションビルド
npm run build

# ビルドしたアプリの起動
npm start
```

### Renderへのデプロイ

`render.yaml` を使用してRenderに自動デプロイされます。

```yaml
services:
  - type: web
    name: xml-to-pdf-converter
    runtime: docker
    plan: free
    region: oregon
```

### Docker本番環境

```bash
# イメージビルド
docker build -t xml-to-pdf-converter .

# コンテナ起動
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  xml-to-pdf-converter
```

## 使い方

1. アプリケーションを開く
2. 公文書ZIPファイルをドラッグ&ドロップ、または選択
3. 「PDFに変換」ボタンをクリック
4. 変換されたZIPファイル（元ファイル + 生成PDF）が自動ダウンロードされます

### 出力形式

ダウンロードされるZIPファイルには以下が含まれます：

```
公文書(002)_converted.zip
├── 元のファイル/
│   ├── 202508202132142994.xml
│   ├── kagami.xsl
│   ├── 7130001.xml
│   ├── 7130001.xsl
│   ├── 7200001.xml
│   └── 7200001.xsl
└── 生成されたPDF/
    ├── 田中一郎様_日本年金機構からのお知らせ.pdf
    ├── 山田太郎様他1名_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf
    └── 山田太郎様他1名_厚生年金保険70歳以上被用者標準報酬月額相当額決定のお知らせ.pdf
```

## PDF変換ロジック

### 全体フロー

```
ZIPアップロード → ZIP解凍 → 被保険者情報抽出 → HTML変換 → PDF生成 → ZIP作成
```

### 1. ZIP解凍 (`app/api/convert/route.ts`)

- ルートレベルのXML/XSLファイルを抽出
- ネストされたZIPファイルを再帰的に展開
- 対応拡張子: `.xml`, `.xsl`, `.txt`

```typescript
// ネストされたZIP構造にも対応
返戻のお知らせ.zip
└── 202508261727120754.zip  // ← これも自動展開
    └── 202508261727120754/
        ├── kagami.xml
        └── henrei.xml
```

### 2. 被保険者情報抽出 (`lib/xml-parser.ts`)

各通知書XMLから被保険者情報を抽出し、個別のXMLを生成：

```typescript
// 7130001.xml（複数被保険者）
<N7130001>
  <_被保険者>
    <被保険者氏名><![CDATA[山田太郎]]></被保険者氏名>
    ...
  </_被保険者>
  <_被保険者>
    <被保険者氏名><![CDATA[鈴木花子]]></被保険者氏名>
    ...
  </_被保険者>
</N7130001>

↓ 抽出

[
  { name: "山田太郎", xmlContent: "個別XML1" },
  { name: "鈴木花子", xmlContent: "個別XML2" }
]
```

### 3. XSLT変換 (`lib/xslt-processor.ts`)

各被保険者の個別XMLをHTMLに変換：

- ブラウザネイティブの`XSLTProcessor`を使用
- Puppeteerで実行（完全なDOM環境）
- XSLスタイルシート最適化（HTML tag正規化、テキスト折り返し）

```typescript
XML + XSL → XSLTProcessor → HTML
```

### 4. HTML結合 (`lib/zip-to-pdf.ts`)

複数被保険者のHTMLを1つに結合：

```html
<!DOCTYPE html>
<html>
  <body>
    <div class="document-container">山田太郎のHTML</div>
    <div class="page-break"></div>
    <div class="document-container">鈴木花子のHTML</div>
  </body>
</html>
```

`page-break-after: always` により、PDF生成時に自動的に改ページされます。

### 5. PDF生成 (`lib/pdf-generator.ts`)

PuppeteerでHTMLをPDFに変換：

- A4サイズ（210mm × 297mm）
- マージン: 上下5mm、左右10mm
- 日本語フォント対応（Noto CJK, IPAfont）
- 元のレイアウト保持（640px × 940px設計を尊重）

### 6. ファイル名生成 (`lib/document-names.ts`)

```typescript
被保険者名リスト → ファイル名

["山田太郎"]
  → "山田太郎様_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf"

["山田太郎", "鈴木花子"]
  → "山田太郎様他1名_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf"

["山田太郎", "鈴木花子", "佐藤次郎"]
  → "山田太郎様他2名_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf"
```

### パフォーマンス最適化

- **ブラウザプール**: Puppeteerインスタンスを再利用（起動コスト削減）
- **自動再起動**: 30-50リクエストごとにブラウザを再起動（メモリリーク防止）
- **高速レンダリング**: `waitUntil: "domcontentloaded"` で不要な待機時間削除

```
初回: 2.2秒
2回目以降: 0.6秒（86%高速化）
```

### メモリ管理

- アイドル時: ~100MB
- 変換中: ~150-200MB
- 自動再起動: 環境変数`MAX_REQUESTS_PER_BROWSER`で設定可能（デフォルト: 50）
- Render free tier（512MB）で安定動作

## トラブルシューティング

### Puppeteerが起動しない

ローカル開発環境でPuppeteerが起動しない場合：

```bash
# Chromiumを再インストール
npx puppeteer browsers install chrome
```

### 日本語フォントが表示されない

Dockerコンテナ内で日本語が表示されない場合は、Dockerfileに以下のフォントが含まれていることを確認：

- fonts-noto-cjk
- fonts-ipafont-gothic
- fonts-ipafont-mincho

### メモリ不足エラー

大きなZIPファイルを処理する場合、Node.jsのメモリ制限を増やす：

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm start
```

## ライセンス

MIT
