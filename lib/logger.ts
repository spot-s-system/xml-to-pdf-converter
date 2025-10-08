/**
 * ログ出力用ユーティリティ
 */

/**
 * タイムスタンプ付きログメッセージを生成
 */
export function log(message: string, emoji = ''): void {
  const timestamp = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  console.log(`[${timestamp}] ${emoji}${emoji ? ' ' : ''}${message}`);
}

/**
 * インデント付きログメッセージを生成
 */
export function logIndent(message: string, level = 1, emoji = ''): void {
  const indent = '  '.repeat(level);
  console.log(`${indent}${emoji}${emoji ? ' ' : ''}${message}`);
}

/**
 * 処理時間を人間が読みやすい形式に変換
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * プログレスバーを生成
 */
export function createProgressBar(current: number, total: number, width = 20): string {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${percentage}%`;
}

/**
 * ファイル名を短縮表示
 */
export function truncateFileName(fileName: string, maxLength = 50): string {
  if (fileName.length <= maxLength) {
    return fileName;
  }
  const extension = fileName.substring(fileName.lastIndexOf('.'));
  const nameLength = maxLength - extension.length - 3; // "..."の分
  return fileName.substring(0, nameLength) + '...' + extension;
}

/**
 * エラーログを出力
 */
export function logError(message: string, error: unknown): void {
  const timestamp = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  console.error(`[${timestamp}] ❌ ${message}`);
  if (error instanceof Error) {
    console.error(`  └─ ${error.message}`);
    if (error.stack) {
      const stackLines = error.stack.split('\n').slice(1, 3);
      stackLines.forEach(line => {
        console.error(`     ${line.trim()}`);
      });
    }
  } else {
    console.error(`  └─ ${String(error)}`);
  }
}

/**
 * 成功ログを出力
 */
export function logSuccess(message: string): void {
  log(message, '✅');
}

/**
 * 警告ログを出力
 */
export function logWarning(message: string): void {
  log(message, '⚠️');
}

/**
 * 情報ログを出力
 */
export function logInfo(message: string): void {
  log(message, 'ℹ️');
}

/**
 * 処理開始ログを出力
 */
export function logStart(message: string): void {
  log(message, '🚀');
}

/**
 * 処理中ログを出力
 */
export function logProcessing(message: string): void {
  log(message, '⚙️');
}