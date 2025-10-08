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
import {
  log,
  logIndent,
  logStart,
  logSuccess,
  formatDuration,
  truncateFileName,
} from '@/lib/logger';

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

    const startTime = Date.now();
    logStart(`Processing: ${truncateFileName(file.name)} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

    // ファイルをBufferに変換
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Step 1: ZIPを解凍
    log('Extracting ZIP file...', '📦');
    const extractStartTime = Date.now();
    tempPath = await extractZipFile(buffer);
    logIndent(`Extracted in ${formatDuration(Date.now() - extractStartTime)}`, 1, '✓');

    // Step 2: フォルダ構造を分析
    log('Analyzing folder structure...', '🔍');
    const analyzeStartTime = Date.now();
    const folders = await analyzeFolderStructure(tempPath);
    logIndent(`Found ${folders.length} folders in ${formatDuration(Date.now() - analyzeStartTime)}`, 1, '✓');

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
    log('Folder contents:', '📁');
    folders.forEach((folder) => {
      const folderName = truncateFileName(folder.folderName, 60);
      const docIcon = folder.documents.length > 0 ? '📄' : '📭';
      const otherIcon = folder.otherFiles.length > 0 ? '📎' : '';
      logIndent(
        `${folderName}: ${docIcon} ${folder.documents.length} docs ${otherIcon} ${folder.otherFiles.length > 0 ? `${folder.otherFiles.length} files` : ''}`,
        1
      );
    });

    // Step 3: 各フォルダのドキュメントをPDF化
    log('Converting documents to PDFs...', '🔄');
    const processedFolders = await processFolders(folders);

    // 結果をサマリー
    const successCount = processedFolders.filter((f) => f.success).length;
    const errorCount = processedFolders.filter((f) => !f.success).length;
    const totalTime = Date.now() - startTime;

    log(`Conversion complete in ${formatDuration(totalTime)}`, '🏁');
    logIndent(`Success: ${successCount}/${folders.length} folders`, 1, '✅');
    if (errorCount > 0) {
      logIndent(`Failed: ${errorCount} folders`, 1, '❌');
    }

    // 詳細結果
    log('Results:', '📊');
    processedFolders.forEach((folder) => {
      if (folder.success) {
        logIndent(
          `✓ ${truncateFileName(folder.folderName, 50)}: ${folder.pdfs?.length || 0} PDFs`,
          1
        );
      } else {
        logIndent(
          `✗ ${truncateFileName(folder.folderName, 50)}: ${folder.error}`,
          1
        );
      }
    });

    // Step 4: 結果をZIPにまとめる
    log('Creating result ZIP...', '🗜️');
    const zipStartTime = Date.now();
    const resultZip = await createResultZip(processedFolders, tempPath);
    logIndent(`ZIP created: ${(resultZip.length / 1024 / 1024).toFixed(2)}MB in ${formatDuration(Date.now() - zipStartTime)}`, 1, '✓');

    // Step 5: 一時ディレクトリをクリーンアップ
    if (tempPath) {
      log('Cleaning up temporary files...', '🧹');
      await cleanupTempDirectory(tempPath);
    }

    logSuccess(`All processing complete! Total time: ${formatDuration(totalTime)}`);

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
