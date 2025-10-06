# XML to PDF Converter

公文書ZIPファイル（XML/XSL形式）をPDFに変換するWebアプリケーション

## 概要

このアプリケーションは、日本の公的機関で使用される電子申請ファイル（ZIP形式）を受け取り、内部のXML/XSLドキュメントをPDFに変換します。

### 主な機能

- ✅ ZIPファイルのドラッグ&ドロップアップロード
- ✅ ネストされたZIPファイルの自動展開
- ✅ XSLT変換によるXML→HTML変換
- ✅ Puppeteerを使用したPDF生成
- ✅ 日本語フォント完全対応
- ✅ A4サイズ最適化

### 対応ドキュメント形式

- 標準報酬決定通知書 (7130001.xml)
- 70歳以上被用者通知書 (7200001.xml)
- 返戻票 (henrei.xml)
- 表紙 (kagami.xml)
- その他汎用XML/XSLペア

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
4. 変換されたPDFが自動ダウンロードされます

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
