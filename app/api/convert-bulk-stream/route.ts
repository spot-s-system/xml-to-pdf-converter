/**
 * 一括ZIP変換APIエンドポイント（リアルタイムストリーミング版）
 * POST /api/convert-bulk-stream
 *
 * メモリ最適化:
 * - 結果ZIPは一時ファイルに書き出し、/api/download/{id} でストリーミング配信する
 *   （base64データURLを廃止してピークメモリを大幅削減）
 * - PDF生成バッファは生成直後に解放し、JSZipにはストリーム参照のみ保持する
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  extractZipFile,
  analyzeFolderStructure,
  processFoldersToZip,
  streamZipToTempFile,
  cleanupTempDirectory,
} from '@/lib/bulk-zip-processor';
import {
  logStart,
  formatDuration,
  truncateFileName,
} from '@/lib/logger';
import { registerDownload } from '@/lib/download-store';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5分

export async function POST(request: NextRequest) {
  let tempPath: string | null = null;

  // SSE用のレスポンスストリームを作成
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let isControllerClosed = false;

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
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
          sendError('ファイルが指定されていません');
          controller.close();
          return;
        }

        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) {
          sendError(`ファイルサイズが大きすぎます（最大${maxSize / 1024 / 1024}MB）`);
          controller.close();
          return;
        }

        if (!file.name.toLowerCase().endsWith('.zip')) {
          sendError('ZIPファイルをアップロードしてください');
          controller.close();
          return;
        }

        const startTime = Date.now();
        const startMessage = `Processing: ${truncateFileName(file.name)} (${(file.size / 1024 / 1024).toFixed(2)}MB)`;
        logStart(startMessage);
        sendLog(startMessage);

        // ファイルをBufferに変換（formDataからの読み込みは一時的に必要）
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Step 1: ZIPを解凍
        sendLog('📦 Extracting ZIP file...');
        const extractStartTime = Date.now();
        tempPath = await extractZipFile(buffer);
        sendLog(`✓ Extracted in ${formatDuration(Date.now() - extractStartTime)}`);

        // Step 2: フォルダ構造を分析
        sendLog('🔍 Analyzing folder structure...');
        const analyzeStartTime = Date.now();
        const folders = await analyzeFolderStructure(tempPath);
        sendLog(`✓ Found ${folders.length} folders in ${formatDuration(Date.now() - analyzeStartTime)}`);

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

        // Step 3+4: フォルダ処理 → JSZipに直接書き込み（メモリ効率版）
        sendLog('🔄 Converting documents to PDFs...');
        let successCount = 0;
        let errorCount = 0;
        const zip = await processFoldersToZip(folders, tempPath, {
          onLog: sendLog,
          onFolderComplete: (_i, _t, _name, success) => {
            if (success) {
              successCount++;
            } else {
              errorCount++;
            }
          },
        });

        const totalTime = Date.now() - startTime;
        sendLog(`🏁 Conversion complete in ${formatDuration(totalTime)}`);
        sendLog(`✅ Success: ${successCount}/${folders.length} folders`);
        if (errorCount > 0) {
          sendLog(`❌ Failed: ${errorCount} folders`);
        }

        // Step 5: ZIPを一時ファイルへストリーム書き出し（base64廃止）
        sendLog('🗜️ Creating result ZIP (streaming to disk)...');
        const zipStartTime = Date.now();
        const resultZipPath = await streamZipToTempFile(zip);
        sendLog(`✓ ZIP created in ${formatDuration(Date.now() - zipStartTime)}`);

        // Step 6: 一時抽出ディレクトリをクリーンアップ（結果ZIPは別の場所にあるので影響なし）
        if (tempPath) {
          sendLog('🧹 Cleaning up temporary files...');
          await cleanupTempDirectory(tempPath);
          tempPath = null;
        }

        sendLog(`✨ All processing complete! Total time: ${formatDuration(totalTime)}`);

        // ダウンロードIDを発行してURLとして送信（base64データURLは使わない）
        const fileName = file.name.replace('.zip', '_変換結果.zip');
        const downloadId = registerDownload(resultZipPath, fileName);
        const downloadUrl = `/api/download/${downloadId}`;

        sendComplete(downloadUrl);
      } catch (error) {
        console.error('Bulk conversion error:', error);
        sendError(error instanceof Error ? error.message : '変換中にエラーが発生しました');

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
