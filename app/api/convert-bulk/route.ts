/**
 * 一括ZIP変換APIエンドポイント
 * POST /api/convert-bulk
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  extractZipFile,
  analyzeFolderStructure,
  processFolders,
  createResultZip,
  cleanupTempDirectory,
} from '@/lib/bulk-zip-processor';

export const maxDuration = 300; // 5分（Vercel Pro）

export async function POST(request: NextRequest) {
  let tempPath: string | null = null;

  try {
    // フォームデータからZIPファイルを取得
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'ファイルが指定されていません' },
        { status: 400 }
      );
    }

    // ファイルサイズチェック (最大100MB)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          success: false,
          error: `ファイルサイズが大きすぎます（最大${maxSize / 1024 / 1024}MB）`,
        },
        { status: 400 }
      );
    }

    // ZIPファイルかチェック
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return NextResponse.json(
        { success: false, error: 'ZIPファイルをアップロードしてください' },
        { status: 400 }
      );
    }

    console.log(`Processing bulk ZIP file: ${file.name} (${file.size} bytes)`);

    // ファイルをBufferに変換
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Step 1: ZIPを解凍
    console.log('Extracting ZIP file...');
    tempPath = await extractZipFile(buffer);
    console.log(`Extracted to: ${tempPath}`);

    // Step 2: フォルダ構造を分析
    console.log('Analyzing folder structure...');
    const folders = await analyzeFolderStructure(tempPath);
    console.log(`Found ${folders.length} folders`);

    if (folders.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: '処理可能なフォルダが見つかりませんでした',
        },
        { status: 400 }
      );
    }

    // フォルダ情報をログ出力
    folders.forEach((folder) => {
      console.log(
        `  - ${folder.folderName}: ${folder.documents.length} documents, ${folder.otherFiles.length} other files`
      );
    });

    // Step 3: 各フォルダのドキュメントをPDF化
    console.log('Converting documents to PDFs...');
    const processedFolders = await processFolders(folders);

    // 結果をサマリー
    const successCount = processedFolders.filter((f) => f.success).length;
    const errorCount = processedFolders.filter((f) => !f.success).length;

    console.log(`Conversion complete: ${successCount} succeeded, ${errorCount} failed`);

    processedFolders.forEach((folder) => {
      if (folder.success) {
        console.log(
          `  ✓ ${folder.folderName}: ${folder.pdfs?.length || 0} PDFs generated`
        );
      } else {
        console.log(`  ✗ ${folder.folderName}: ${folder.error}`);
      }
    });

    // Step 4: 結果をZIPにまとめる
    console.log('Creating result ZIP...');
    const resultZip = await createResultZip(processedFolders, tempPath);
    console.log(`Result ZIP created: ${resultZip.length} bytes`);

    // Step 5: 一時ディレクトリをクリーンアップ
    if (tempPath) {
      await cleanupTempDirectory(tempPath);
      console.log('Temp directory cleaned up');
    }

    // 結果を返す
    const fileName = file.name.replace('.zip', '_変換結果.zip');

    return new NextResponse(resultZip as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'X-Total-Folders': folders.length.toString(),
        'X-Success-Count': successCount.toString(),
        'X-Error-Count': errorCount.toString(),
      },
    });
  } catch (error) {
    console.error('Bulk conversion error:', error);

    // クリーンアップ
    if (tempPath) {
      await cleanupTempDirectory(tempPath);
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : '変換中にエラーが発生しました',
      },
      { status: 500 }
    );
  }
}

// オプション: 進捗状況を返すエンドポイント（将来的に実装可能）
export async function GET() {
  return NextResponse.json({
    message: 'Use POST method to upload a bulk ZIP file',
  });
}
