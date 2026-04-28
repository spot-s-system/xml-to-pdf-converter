/**
 * 一時ダウンロードファイルの登録・取得を管理するインメモリストア
 * - SSE変換完了時に結果ZIPを一時ファイルとして登録し、ID経由で配信する
 * - メモリにbase64文字列を保持しないことでRender無料枠（512MB）の枯渇を防ぐ
 */

import fs from 'fs/promises';
import { randomUUID } from 'crypto';

export interface DownloadEntry {
  filePath: string;
  fileName: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10分でクリーンアップ
const SWEEP_INTERVAL_MS = 60 * 1000;

// Next.js devのHMRやroute間で別モジュールインスタンスとなるケースを跨ぐため、
// globalThisにアタッチして永続化する
const GLOBAL_KEY = Symbol.for('xmlPdfConverter.downloadStore.v1');
type GlobalWithStore = typeof globalThis & {
  [GLOBAL_KEY]?: { store: Map<string, DownloadEntry>; sweeperStarted: boolean };
};
const g = globalThis as GlobalWithStore;
if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = { store: new Map<string, DownloadEntry>(), sweeperStarted: false };
}
const state = g[GLOBAL_KEY]!;
const store = state.store;

function startSweeper(): void {
  if (state.sweeperStarted) return;
  state.sweeperStarted = true;

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of store.entries()) {
      if (now - entry.createdAt > TTL_MS) {
        store.delete(id);
        fs.unlink(entry.filePath).catch(() => {
          // すでに削除済みの可能性があるため無視
        });
      }
    }
  }, SWEEP_INTERVAL_MS);

  // Node.jsプロセス終了をブロックしないようにunref
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

export function registerDownload(filePath: string, fileName: string): string {
  startSweeper();
  const id = randomUUID();
  store.set(id, { filePath, fileName, createdAt: Date.now() });
  return id;
}

export function consumeDownload(id: string): DownloadEntry | null {
  const entry = store.get(id);
  if (!entry) return null;
  store.delete(id);
  return entry;
}

export function peekDownload(id: string): DownloadEntry | null {
  return store.get(id) ?? null;
}
