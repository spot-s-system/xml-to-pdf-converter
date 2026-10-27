/**
 * 親ウィンドウ（spot-s-admin のe-Gov申請一覧）からのZIP受け渡し（postMessage ハンドオフ）
 *
 * spot-s-admin の公文書ダイアログ「リネームアプリを使ってDL」は、本アプリを
 * `/?handoff=1` 付きのポップアップで開き、次の手順でZIPを渡す。
 *
 *   1. 本アプリ → opener : { type: 'xml-to-pdf:ready' }（ZIP受信まで1秒毎に再送）
 *   2. opener → 本アプリ : { type: 'xml-to-pdf:file', fileName, data: ArrayBuffer }
 *   3. 本アプリ → opener : progress / complete / error を随時通知
 *
 * ready には一切データを載せないため targetOrigin は '*' で送る（opener の
 * origin はクロスオリジンでは読めない）。受信側は ALLOWED_OPENER_ORIGIN_PATTERNS
 * に一致する origin からのメッセージだけを受け付け、以降の通知はその origin
 * 宛てに限定して送る。
 */

export const HANDOFF_QUERY_PARAM = 'handoff';

export type HandoffInboundMessage = {
  type: 'xml-to-pdf:file';
  fileName: string;
  data: ArrayBuffer;
};

export type HandoffOutboundMessage =
  | { type: 'xml-to-pdf:ready' }
  | { type: 'xml-to-pdf:progress'; percent: number; message: string | null }
  | { type: 'xml-to-pdf:complete' }
  | { type: 'xml-to-pdf:error'; message: string };

const ALLOWED_OPENER_ORIGIN_PATTERNS: RegExp[] = [
  // 本番・プレビュー（spot-s-admin-xxxx-spot-s-system.vercel.app 等）
  /^https:\/\/spot-s-admin(?:-[a-z0-9-]+)?\.vercel\.app$/,
  // ローカル開発
  /^http:\/\/localhost:\d+$/,
];

/** 環境変数 NEXT_PUBLIC_HANDOFF_ALLOWED_ORIGINS（カンマ区切り）で独自ドメイン等を追加できる */
function extraAllowedOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_HANDOFF_ALLOWED_ORIGINS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedOpenerOrigin(origin: string): boolean {
  if (extraAllowedOrigins().includes(origin)) return true;
  return ALLOWED_OPENER_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export function isHandoffFileMessage(data: unknown): data is HandoffInboundMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  return (
    msg.type === 'xml-to-pdf:file' &&
    typeof msg.fileName === 'string' &&
    msg.data instanceof ArrayBuffer
  );
}

/** opener から受け取ったファイル名を安全な .zip 名に整える */
export function sanitizeHandoffFileName(fileName: string): string {
  const base = fileName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'koubunsho';
  return base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`;
}
