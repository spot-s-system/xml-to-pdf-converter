/**
 * 一時的に保存された変換結果ZIPをストリーミング配信
 * GET /api/download/[id]
 *
 * - download-storeに登録されたIDに紐づくファイルをfs.createReadStreamで配信
 * - 配信完了後にファイルを削除（再ダウンロード不可・メモリ常駐回避）
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { Readable } from 'stream';
import { consumeDownload } from '@/lib/download-store';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const entry = consumeDownload(id);
  if (!entry) {
    return NextResponse.json(
      { error: 'ダウンロードリンクが無効か、有効期限切れです' },
      { status: 404 }
    );
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(entry.filePath);
  } catch {
    return NextResponse.json(
      { error: 'ファイルが見つかりません' },
      { status: 404 }
    );
  }

  const nodeStream = fs.createReadStream(entry.filePath);

  // ストリーム終了 or エラー時に一時ファイルを削除
  const cleanup = () => {
    fs.promises.unlink(entry.filePath).catch(() => {});
  };
  nodeStream.once('end', cleanup);
  nodeStream.once('error', cleanup);
  nodeStream.once('close', cleanup);

  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(entry.fileName)}`,
      'Content-Length': stat.size.toString(),
      'Cache-Control': 'no-store',
    },
  });
}
