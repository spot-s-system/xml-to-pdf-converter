/**
 * 一括ZIP変換APIエンドポイント（リアルタイムストリーミング版）
 * POST /api/convert-bulk-stream
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
  logStart,
  formatDuration,
  truncateFileName,
} from '@/lib/logger';

export const maxDuration = 300; // 5分（Vercel Pro）

export async function POST(request: NextRequest) {
  let tempPath: string | null = null;

  // SSE用のレスポンスストリームを作成
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let isControllerClosed = false;

      // ログ送信関数
      const sendLog = (message: string) => {
        if (isControllerClosed) return;
        try {
          const data = `data: ${JSON.stringify({ log: message })}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (err) {
          console.error('Failed to send log:', err);
          isControllerClosed = true;
        }
      };

      // エラー送信関数
      const sendError = (error: string) => {
        if (isControllerClosed) return;
        try {
          const data = `data: ${JSON.stringify({ error })}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch (err) {
          console.error('Failed to send error:', err);
          isControllerClosed = true;
        }
      };

      // 完了送信関数
      const sendComplete = (downloadUrl?: string) => {
        if (isControllerClosed) return;
        try {
          const data = `data: ${JSON.stringify({ complete: true, downloadUrl })}\n\n`;
          controller.enqueue(encoder.encode(data));
          controller.close();
          isControllerClosed = true;
        } catch (err) {
          console.error('Failed to send complete:', err);
          isControllerClosed = true;
        }
      };

      try {
        // フォームデータからZIPファイルを取得
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
          sendError('ファイルが指定されていません');
          controller.close();
          return;
        }

        // ファイルサイズチェック (最大100MB)
        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) {
          sendError(`ファイルサイズが大きすぎます（最大${maxSize / 1024 / 1024}MB）`);
          controller.close();
          return;
        }

        // ZIPファイルかチェック
        if (!file.name.toLowerCase().endsWith('.zip')) {
          sendError('ZIPファイルをアップロードしてください');
          controller.close();
          return;
        }

        const startTime = Date.now();
        const startMessage = `Processing: ${truncateFileName(file.name)} (${(file.size / 1024 / 1024).toFixed(2)}MB)`;
        logStart(startMessage);
        sendLog(startMessage);

        // ファイルをBufferに変換
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Step 1: ZIPを解凍
        sendLog('📦 Extracting ZIP file...');
        const extractStartTime = Date.now();
        tempPath = await extractZipFile(buffer);
        const extractMessage = `✓ Extracted in ${formatDuration(Date.now() - extractStartTime)}`;
        sendLog(extractMessage);

        // Step 2: フォルダ構造を分析
        sendLog('🔍 Analyzing folder structure...');
        const analyzeStartTime = Date.now();
        const folders = await analyzeFolderStructure(tempPath);
        const analyzeMessage = `✓ Found ${folders.length} folders in ${formatDuration(Date.now() - analyzeStartTime)}`;
        sendLog(analyzeMessage);

        if (folders.length === 0) {
          sendError('処理可能なフォルダが見つかりませんでした');
          controller.close();
          return;
        }

        // フォルダ情報をログ出力
        sendLog('📁 Folder contents:');
        folders.forEach((folder) => {
          const folderName = truncateFileName(folder.folderName, 60);
          const docIcon = folder.documents.length > 0 ? '📄' : '📭';
          const otherIcon = folder.otherFiles.length > 0 ? '📎' : '';
          sendLog(
            `  ${folderName}: ${docIcon} ${folder.documents.length} docs ${otherIcon} ${folder.otherFiles.length > 0 ? `${folder.otherFiles.length} files` : ''}`
          );
        });

        // Step 3: 各フォルダのドキュメントをPDF化（リアルタイムログ付き）
        sendLog('🔄 Converting documents to PDFs...');

        // processFoldersの処理をここでインライン化して、各ステップでログを送信
        const processedFolders = [];
        for (let i = 0; i < folders.length; i++) {
          const folder = folders[i];
          const folderNumber = i + 1;
          const folderProgress = `[${folderNumber}/${folders.length}]`;

          sendLog(`${folderProgress} 📁 Processing: ${truncateFileName(folder.folderName, 50)}`);

          try {
            // ここで実際の処理（簡略版）
            const result = await processFolders([folder]);
            processedFolders.push(...result);

            if (result[0].success) {
              sendLog(`${folderProgress} ✅ Completed: ${result[0].pdfs?.length || 0} PDFs generated`);
            } else {
              sendLog(`${folderProgress} ❌ Failed: ${result[0].error}`);
            }
          } catch (error) {
            sendLog(`${folderProgress} ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            processedFolders.push({
              folderName: folder.folderName,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        // 結果をサマリー
        const successCount = processedFolders.filter((f) => f.success).length;
        const errorCount = processedFolders.filter((f) => !f.success).length;
        const totalTime = Date.now() - startTime;

        sendLog(`🏁 Conversion complete in ${formatDuration(totalTime)}`);
        sendLog(`✅ Success: ${successCount}/${folders.length} folders`);
        if (errorCount > 0) {
          sendLog(`❌ Failed: ${errorCount} folders`);
        }

        // Step 4: 結果をZIPにまとめる
        sendLog('🗜️ Creating result ZIP...');
        const zipStartTime = Date.now();
        const resultZip = await createResultZip(processedFolders, tempPath);
        sendLog(`✓ ZIP created: ${(resultZip.length / 1024 / 1024).toFixed(2)}MB in ${formatDuration(Date.now() - zipStartTime)}`);

        // Step 5: 一時ディレクトリをクリーンアップ
        if (tempPath) {
          sendLog('🧹 Cleaning up temporary files...');
          await cleanupTempDirectory(tempPath);
        }

        sendLog(`✨ All processing complete! Total time: ${formatDuration(totalTime)}`);

        // 結果をBase64エンコードして送信
        const base64Zip = resultZip.toString('base64');
        const fileName = file.name.replace('.zip', '_変換結果.zip');

        sendComplete(`data:application/zip;base64,${base64Zip}#${encodeURIComponent(fileName)}`);

      } catch (error) {
        console.error('Bulk conversion error:', error);
        sendError(error instanceof Error ? error.message : '変換中にエラーが発生しました');

        // クリーンアップ
        if (tempPath) {
          await cleanupTempDirectory(tempPath);
        }

        if (!isControllerClosed) {
          try {
            controller.close();
            isControllerClosed = true;
          } catch (err) {
            console.error('Failed to close controller:', err);
          }
        }
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}