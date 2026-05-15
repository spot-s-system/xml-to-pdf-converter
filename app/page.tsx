"use client";

import { useState, useRef, useEffect } from "react";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileText, Download, AlertCircle, Terminal, Copy, CheckCircle } from "lucide-react";

// 秒数を「Xm Ys」形式に整形（1分未満なら「Ys」のみ）
function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}秒`;
  return `${m}分${s}秒`;
}

export default function Home() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  // 所要時間計測用
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [folderProgress, setFolderProgress] = useState<{ current: number; total: number } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ログ末尾への自動スクロール（ログコンテナの内部スクロールのみ動かす）
  //
  // 以前は logsEndRef.current?.scrollIntoView() を使っていたが、これだと
  // ページ全体がログ末尾の位置までスクロールし、アップロードカード内の
  // 進捗バー（変換の経過の帯）が画面外に押し出されてしまう。
  // ログコンテナ（max-h-[400px] overflow-y-auto の親要素）の scrollTop を
  // 直接 scrollHeight に揃えて、ページ全体のスクロールは触らないようにする。
  useEffect(() => {
    const container = logsEndRef.current?.parentElement;
    if (container) container.scrollTop = container.scrollHeight;
  }, [logs]);

  // 経過時間を1秒ごとに更新（変換中のみ）
  useEffect(() => {
    if (!isConverting || startTime === null) return;
    const tick = () => setElapsedSeconds((Date.now() - startTime) / 1000);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isConverting, startTime]);

  // ログから [current/total] パターンを拾ってフォルダ進捗を更新
  useEffect(() => {
    if (logs.length === 0) return;
    // 最後尾のフォルダ系ログから抽出
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = logs[i].match(/^\[(\d+)\/(\d+)\]/);
      if (m) {
        const current = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        setFolderProgress(prev => {
          if (prev && prev.current === current && prev.total === total) return prev;
          return { current, total };
        });
        // フォルダ進捗ベースで progress% を更新（5〜95%の範囲）
        const ratio = current / total;
        setProgress(Math.max(5, Math.min(95, Math.round(ratio * 95))));
        break;
      }
    }
  }, [logs]);

  // 推定残り時間: 完了済みフォルダ数から1フォルダあたり時間を概算
  // 完了マーカー（✅ Completed）の数を完了済みとして数える
  const completedFolders = logs.reduce((acc, l) => acc + (/\]\s*✅\s*Completed/.test(l) ? 1 : 0), 0);
  const estimatedTotalSeconds = (() => {
    if (!folderProgress) return null;
    if (completedFolders === 0) return null;
    const perFolder = elapsedSeconds / completedFolders;
    return perFolder * folderProgress.total;
  })();
  const estimatedRemainingSeconds = estimatedTotalSeconds !== null
    ? Math.max(0, estimatedTotalSeconds - elapsedSeconds)
    : null;

  // ログをクリップボードにコピー
  const copyLogsToClipboard = async () => {
    const logText = logs.join('\n');
    try {
      await navigator.clipboard.writeText(logText);
      setCopiedToClipboard(true);
      setTimeout(() => setCopiedToClipboard(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  // ダウンロード処理を関数として抽出
  const handleDownload = (downloadUrl: string) => {
    try {
      // サーバー側ストリーミング配信URL（/api/download/{id}）
      // Content-Disposition ヘッダーがファイル名を提供するため、navigation でダウンロード
      if (downloadUrl.startsWith('/api/download/') || downloadUrl.startsWith('http')) {
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.rel = 'noopener';
        // download属性を空文字で指定するとContent-Dispositionのfilenameが優先される
        a.setAttribute('download', '');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => {
          setProgress(0);
          setIsConverting(false);
        }, 500);
        return;
      }

      // 後方互換: 旧来のbase64データURL形式もハンドリング
      const [dataUrl, filename] = downloadUrl.split('#');
      const base64 = dataUrl.split(',')[1];
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = decodeURIComponent(filename);
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setTimeout(() => {
        setProgress(0);
        setIsConverting(false);
      }, 500);
    } catch (err) {
      console.error('Download failed:', err);
      setError('ダウンロードに失敗しました');
      setIsConverting(false);
    }
  };

  const handleConvert = async () => {
    if (!zipFile) {
      setError("ZIPファイルを選択してください");
      return;
    }

    setIsConverting(true);
    setProgress(0);
    setError(null);
    setLogs([]);
    setStartTime(Date.now());
    setElapsedSeconds(0);
    setFolderProgress(null);

    try {
      const formData = new FormData();
      formData.append("file", zipFile);

      setProgress(20);

      // SSEを使用してリアルタイムログを受信
      const response = await fetch("/api/convert-bulk-stream", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTPエラー: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("レスポンスストリームが取得できません");
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        // ストリームが終了した場合でも、バッファに残っているデータを処理
        if (done) {
          // 最後のバッファを処理
          if (buffer.trim()) {
            const lines = buffer.split('\n\n').filter(line => line.trim());
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.substring(6));

                  if (data.log) {
                    setLogs(prev => [...prev, data.log]);
                  } else if (data.error) {
                    setError(data.error);
                  } else if (data.complete) {
                    setProgress(100);

                    // ダウンロード処理を実行
                    if (data.downloadUrl) {
                      handleDownload(data.downloadUrl);
                    } else {
                      setError('ダウンロードURLが見つかりません');
                      setIsConverting(false);
                    }
                  }
                } catch (e) {
                  console.error("Failed to parse SSE data:", e);
                }
              }
            }
          }
          break;
        }

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));

              if (data.log) {
                setLogs(prev => [...prev, data.log]);
                // progress% はフォルダ進捗ログの useEffect 側で更新する
              } else if (data.error) {
                setError(data.error);
                setIsConverting(false);
              } else if (data.complete) {
                setProgress(100);

                // ダウンロード処理を実行
                if (data.downloadUrl) {
                  handleDownload(data.downloadUrl);
                } else {
                  setError('ダウンロードURLが見つかりません');
                  setIsConverting(false);
                }
              }
            } catch (e) {
              console.error("Failed to parse SSE data:", e);
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "変換中にエラーが発生しました");
      setIsConverting(false);
      setProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* コンパクト hero: スクロール不要にするため最小限の高さに収める */}
        <div className="text-center mb-4">
          <h1 className="text-2xl md:text-3xl font-bold flex items-center justify-center gap-2">
            <FileText className="h-6 w-6 md:h-7 md:w-7 text-primary" />
            公文書ZIP to PDF変換・リネームアプリ
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            公文書ZIPファイルをアップロードして、個別PDFを含むZIPファイルを生成。同梱PDFのリネームも自動で行います。
          </p>
        </div>

        {/* 2カラムレイアウト: アップロード (左, 3/5) + 使い方 (右, 2/5)
            lg未満は1カラムに折り返して縦並びになる */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
          <div className="lg:col-span-3 space-y-4 lg:space-y-6">

        {/* アップロードカード */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>ZIPファイルアップロード</CardTitle>
            <CardDescription>
              XML/XSLファイルを含むZIPファイルをアップロードしてください
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FileDropzone
              label="公文書ZIPファイル"
              accept=".zip"
              onFileSelect={setZipFile}
              selectedFile={zipFile}
              onClear={() => setZipFile(null)}
            />

            <p className="text-xs text-muted-foreground/80">
              ※ 算定基礎届などで被保険者が数十名含まれる場合、10〜20分以上かかることがあります（PDF 1枚あたり約4〜10秒）。
            </p>

            {error && (
              <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {isConverting && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>
                    変換中...
                    {folderProgress && (
                      <span className="ml-2 text-xs">
                        フォルダ {folderProgress.current}/{folderProgress.total}
                      </span>
                    )}
                  </span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>経過時間: {formatDuration(elapsedSeconds)}</span>
                  {estimatedRemainingSeconds !== null ? (
                    <span>
                      推定残り: 約{formatDuration(estimatedRemainingSeconds)}
                      {estimatedTotalSeconds !== null && (
                        <span className="ml-2 opacity-70">(合計目安 約{formatDuration(estimatedTotalSeconds)})</span>
                      )}
                    </span>
                  ) : (
                    <span className="opacity-70">推定残り: 算出中...</span>
                  )}
                </div>
              </div>
            )}

            <Button
              onClick={handleConvert}
              disabled={!zipFile || isConverting}
              className="w-full"
              size="lg"
            >
              {isConverting ? (
                <>変換中...</>
              ) : (
                <>
                  <Download className="h-5 w-5 mr-2" />
                  一括変換
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* リアルタイムログ（アップロードカードの下、同じ左カラム内に表示） */}
        {(logs.length > 0 || isConverting) && (
          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Terminal className="h-5 w-5" />
                    リアルタイム変換ログ
                  </CardTitle>
                  <CardDescription className="mt-1">変換処理の詳細がリアルタイムで表示されます</CardDescription>
                </div>
                {logs.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyLogsToClipboard}
                    disabled={copiedToClipboard}
                  >
                    {copiedToClipboard ? (
                      <>
                        <CheckCircle className="h-4 w-4 mr-1" />
                        コピー済み
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-1" />
                        コピー
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-900 text-green-400 p-4 rounded-lg font-mono text-xs max-h-[400px] overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="text-slate-500">
                    処理を開始しています...
                  </div>
                ) : (
                  <>
                    {logs.map((log, index) => (
                      <div key={index} className="mb-1 animate-fade-in">
                        {log}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

          </div>
          {/* 右カラム終端 */}

          {/* 右カラム: 使い方 + 対応手続き種別 */}
          <div className="lg:col-span-2">
        <div className="p-4 lg:p-5 bg-white dark:bg-slate-800 rounded-lg shadow lg:sticky lg:top-4">
          <h2 className="text-base lg:text-lg font-semibold mb-2">使い方</h2>
          <ol className="list-decimal list-inside space-y-1 text-xs lg:text-sm text-muted-foreground">
            <li>公文書ZIPファイルをドラッグ&ドロップまたはクリックして選択</li>
            <li>「一括変換」ボタンをクリック</li>
            <li>処理状況がリアルタイムでログに表示されます</li>
            <li>変換されたPDFが自動的にダウンロードされます</li>
          </ol>

          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg max-h-[60vh] overflow-y-auto">
            <h3 className="text-sm font-semibold mb-2 text-blue-900 dark:text-blue-100">
              対応手続き種別ごとの処理ロジック
            </h3>
            <p className="text-xs text-blue-800/70 dark:text-blue-200/70 mb-3">
              各手続き種別ごとに、(A) XML→PDF 変換と (B) 既存PDFのリネーム の処理を記載します。各見出しをクリックすると詳細が開きます。
            </p>
            <div className="text-xs text-blue-800 dark:text-blue-200 space-y-2">

              {/* === [社保]資格取得 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]資格取得
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 個人毎）</span></li>
                  <li className="ml-4">対象XML (通常): 7100001.xml（あるいは DataRoot 形式でフォルダ名 <code>[社保]資格取得</code> を含む）</li>
                  <li className="ml-4">出力: {'{名前}様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf'}</li>
                  <li className="ml-4 pt-1">対象XML (70歳以上): 7180001.xml</li>
                  <li className="ml-4">出力: {'{名前}様_厚生年金保険70歳以上被用者該当および標準報酬月額相当額のお知らせ.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">被保険者名はXML（{'<TITLE>'}/被保険者ブロックの &lt;被保険者漢字氏名&gt; または &lt;被用者漢字氏名&gt;）から取得。取れない場合はフォルダ名 <code>{'…_{被保険者名}_[社保]資格取得_…'}</code> から補完。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのページ分割＋リネーム</span></li>
                  <li className="ml-4">対象: 同梱の <code>7100001.pdf</code> / <code>7180001.pdf</code>（被保険者ごとにページが分かれている公文書PDF）</li>
                  <li className="ml-4">出力 (7100001): {'{被保険者名}様_健康保険・厚生年金保険資格取得確認および標準報酬決定通知書.pdf'}</li>
                  <li className="ml-4">出力 (7180001): {'{被保険者名}様_厚生年金保険70歳以上被用者該当および標準報酬月額相当額のお知らせ.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">PDFを1ページずつスキャンし、「被保険者氏名」欄から名前を読み取って個別PDFに分割。各分割PDFには通知書末尾の付記/不服申立て案内ページを同梱します。名前が読み取れない場合はその元PDFをそのまま残置します。</li>
                </ul>
              </details>

              {/* === [社保]扶養異動 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]扶養異動
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 個人毎）</span></li>
                  <li className="ml-4">対象XML: 7170003.xml</li>
                  <li className="ml-4">出力: {'{名前}様_健康保険被扶養者（異動）決定通知書.pdf'}</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのページ分割＋リネーム</span></li>
                  <li className="ml-4">対象: 同梱の <code>7170003.pdf</code></li>
                  <li className="ml-4">出力: {'{被保険者名}様_健康保険被扶養者（異動）決定通知書.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">PDFを1ページずつスキャンし、「被保険者氏名」欄から名前を読み取って個別PDFに分割。名前が読み取れない場合は元PDFをそのまま残置します。</li>
                </ul>
              </details>

              {/* === [社保]資格喪失 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]資格喪失
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 個人毎）</span></li>
                  <li className="ml-4">対象XML: 7120002.xml（あるいは DataRoot 形式でフォルダ名 <code>[社保]資格喪失</code> を含む）</li>
                  <li className="ml-4">出力: {'{名前}様_健康保険・厚生年金保険資格喪失確認通知書.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">被保険者名がXMLから取れない場合はフォルダ名 <code>{'…_{被保険者名}_[社保]資格喪失_…'}</code> から補完。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのページ分割＋リネーム</span></li>
                  <li className="ml-4">対象: 同梱の <code>7120002.pdf</code></li>
                  <li className="ml-4">出力: {'{被保険者名}様_健康保険・厚生年金保険資格喪失確認通知書.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">PDFを1ページずつスキャンし、「被保険者氏名」欄から名前を読み取って個別PDFに分割。各分割PDFには通知書末尾の付記/不服申立て案内ページを同梱します。名前が読み取れない場合は元PDFをそのまま残置します。</li>
                </ul>
              </details>

              {/* === [社保]月額変更 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]月額変更
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 複数名統合）</span></li>
                  <li className="ml-4">対象XML: 7140001.xml（標準報酬改定通知書） / 7210001.xml（70歳以上被用者月額改定）</li>
                  <li className="ml-4">出力 (7140001): 令和{'{n}'}年{'{m}'}月改定_{'{名前}'}様他N名_健康保険・厚生年金保険被保険者標準報酬改定通知書.pdf</li>
                  <li className="ml-4">出力 (7210001): 令和{'{n}'}年{'{m}'}月改定_{'{名前}'}様他N名_厚生年金保険70歳以上被用者標準報酬月額相当額改定のお知らせ.pdf</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">例: 令和7年9月改定_山田太郎様他1名_…改定通知書.pdf（1名のみの場合は「他N名」を省略）</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">改定年月はXMLから抽出。取れなかった場合は日付プレフィックス無しで出力。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのページ分割＋リネーム</span></li>
                  <li className="ml-4">対象: 同梱の <code>7140001.pdf</code> / <code>7210001.pdf</code></li>
                  <li className="ml-4">出力 (7140001): {'{被保険者名}様_健康保険・厚生年金保険被保険者標準報酬改定通知書.pdf'}</li>
                  <li className="ml-4">出力 (7210001): {'{被保険者名}様_厚生年金保険70歳以上被用者標準報酬月額相当額改定のお知らせ.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">PDFを1ページずつスキャンし、「被保険者氏名」欄から名前を読み取って個別PDFに分割。各分割PDFには通知書末尾の付記/不服申立て案内ページを同梱します。名前が読み取れない場合は元PDFをそのまま残置します。</li>
                </ul>
              </details>

              {/* === [社保]賞与支払届 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]賞与支払届
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 被保険者毎）</span></li>
                  <li className="ml-4">対象XML: 7150001.xml（賞与額決定通知書） / 7220001.xml（70歳以上）</li>
                  <li className="ml-4">出力 (7150001): 令和{'{n}'}年{'{m}'}月{'{d}'}日_{'{名前}'}様_健康保険・厚生年金保険被保険者賞与額決定通知書.pdf</li>
                  <li className="ml-4">出力 (7220001): 令和{'{n}'}年{'{m}'}月{'{d}'}日_{'{名前}'}様_厚生年金保険70歳以上被用者標準賞与額相当額のお知らせ.pdf</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">実データは1XMLあたり1名構造のため、被保険者ごとに1ファイル生成します。</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">賞与支払年月日はXMLから抽出。取れなかった場合は日付プレフィックス無しで出力します。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのページ分割＋リネーム</span></li>
                  <li className="ml-4">対象: 同梱の <code>7150001.pdf</code> / <code>7220001.pdf</code>（複数名分の通知が1PDFにまとまっている場合も含む）</li>
                  <li className="ml-4">出力 (7150001): {'{被保険者名}様_健康保険・厚生年金保険被保険者賞与額決定通知書.pdf'}</li>
                  <li className="ml-4">出力 (7220001): {'{被保険者名}様_厚生年金保険70歳以上被用者標準賞与額相当額のお知らせ.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">PDFを1ページずつスキャンし、「被保険者氏名」欄から名前を読み取って個別PDFに分割（例: 4名分の7150001.pdf → 4個の被保険者別PDF）。各分割PDFには通知書末尾の付記/不服申立て案内ページを同梱します。名前が読み取れない場合は元PDFをそのまま残置します。</li>
                </ul>
              </details>

              {/* === [社保]算定基礎 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]算定基礎
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 個人毎・年度プレフィックス付与）</span></li>
                  <li className="ml-4">対象XML: 7130001.xml（標準報酬決定通知書） / 7200001.xml（70歳以上被用者標準報酬決定）</li>
                  <li className="ml-4">出力 (7130001): 令和{'{n}'}年度算定_{'{名前}'}様_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf</li>
                  <li className="ml-4">出力 (7200001): 令和{'{n}'}年度算定_{'{名前}'}様_厚生年金保険70歳以上被用者標準報酬月額相当額決定のお知らせ.pdf</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">例: 令和7年度算定_鈴木格様_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">年度はXMLの&lt;適用年月&gt;から抽出。算定基礎は適用年月=9月のため、年=年度として使用。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのページ分割＋リネーム</span></li>
                  <li className="ml-4">対象: 同梱の <code>7130001.pdf</code> / <code>7200001.pdf</code>（複数名分の通知が1PDFにまとまっている場合も含む）</li>
                  <li className="ml-4">出力 (7130001): {'{被保険者名}様_健康保険・厚生年金保険被保険者標準報酬決定通知書.pdf'}</li>
                  <li className="ml-4">出力 (7200001): {'{被保険者名}様_厚生年金保険70歳以上被用者標準報酬月額相当額決定のお知らせ.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">PDFを1ページずつスキャンし、「被保険者氏名」欄から名前を読み取って個別PDFに分割。各分割PDFには通知書末尾の付記/不服申立て案内ページを同梱します。名前が読み取れない場合は元PDFをそのまま残置します（XML→PDFと違い、既存PDFには「令和{'{n}'}年度算定_」プレフィックスは付与されません）。</li>
                </ul>
              </details>

              {/* === [社保]新規適用 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]新規適用
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 会社単位）</span></li>
                  <li className="ml-4">対象XML: 7012001.xml（あるいは DataRoot 形式でフォルダ名 <code>[社保]新規適用</code> を含む）</li>
                  <li className="ml-4">出力: （社会保険）適用通知書.pdf</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">会社単位の手続きのため被保険者名は付与しません。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのリネーム（公文書フォルダ）</span></li>
                  <li className="ml-4">対象: <code>_公文書_</code> を含むフォルダ内の既存PDF全て（例: 7012001.pdf など）</li>
                  <li className="ml-4">出力: （社会保険）適用通知書.pdf に統一（元のファイル名形式は問わない）</li>
                </ul>
              </details>

              {/* === [社保]産前産後休業 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]産前産後休業
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 個人毎）</span></li>
                  <li className="ml-4">対象: フォルダ名に <code>[社保]産前産後休業等申出書</code> を含む（XMLがあれば変換）</li>
                  <li className="ml-4">出力: {'{被保険者名}様_健康保険・厚生年金保険産前産後休業取得者確認通知書.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">被保険者名がXMLから取れない場合はフォルダ名から補完。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのリネーム（公文書フォルダ）</span></li>
                  <li className="ml-4">対象: <code>_公文書_</code> を含むフォルダ内の既存PDF全て</li>
                  <li className="ml-4">出力: {'{被保険者名}様_健康保険・厚生年金保険産前産後休業取得者確認通知書.pdf'} に統一</li>
                </ul>
              </details>

              {/* === [社保]育児休業 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [社保]育児休業
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-green-700 dark:text-green-400 font-semibold">変換（XML→PDF, 個人毎）</span></li>
                  <li className="ml-4">対象: フォルダ名に <code>[社保]育児休業等申出書</code> を含む（XMLがあれば変換）</li>
                  <li className="ml-4">出力: {'{被保険者名}様_健康保険・厚生年金保険育児休業等取得者確認通知書.pdf'}</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのリネーム（公文書フォルダ）</span></li>
                  <li className="ml-4">対象: <code>_公文書_</code> を含むフォルダ内の既存PDF全て</li>
                  <li className="ml-4">出力: {'{被保険者名}様_健康保険・厚生年金保険育児休業等取得者確認通知書.pdf'} に統一</li>
                </ul>
              </details>

              {/* === [雇保]資格取得 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [雇保]資格取得
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-gray-500 dark:text-gray-400 font-semibold">— 変換: 対象外 —</span></li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">公文書はPDFで配布されるため、XML→PDF 変換は行いません。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのリネーム</span></li>
                  <li className="ml-4">対象: フォルダ名に <code>[雇保]資格取得</code> を含み、ファイル名が数字で始まる既存PDF</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">例: <code>2501793096_雇用保険被保険者資格取得等確認通知書.pdf</code> / ハイフン区切りの連番 <code>202602021152166333-0001_…</code> も対応</li>
                  <li className="ml-4">出力: {'{被保険者名}様_{元の通知書名}.pdf'}</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">被保険者名はフォルダ名から自動抽出（4フィールド/5フィールド構造の双方に対応、内部スペース保持）。</li>
                </ul>
              </details>

              {/* === [雇保]資格喪失 === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  [雇保]資格喪失
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li><span className="text-gray-500 dark:text-gray-400 font-semibold">— 変換: 対象外 —</span></li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">公文書はPDFで配布されるため、XML→PDF 変換は行いません。</li>
                  <li className="pt-2"><span className="text-green-700 dark:text-green-400 font-semibold">✓ 既存PDFのリネーム</span></li>
                  <li className="ml-4">対象: フォルダ名に <code>[雇保]資格喪失</code>（<code>(離職票交付あり)</code> サブパターン含む）を含み、ファイル名が数字で始まる既存PDF</li>
                  <li className="ml-4 text-xs text-gray-600 dark:text-gray-400">例: <code>2501793096_雇用保険被保険者資格喪失確認通知書.pdf</code> → <code>{'{'}被保険者名{'}'}様_雇用保険被保険者資格喪失確認通知書.pdf</code></li>
                  <li className="ml-4">出力: {'{被保険者名}様_{元の通知書名}.pdf'}</li>
                </ul>
              </details>

              {/* === その他（参考） === */}
              <details className="group rounded border border-blue-200/60 dark:border-blue-800/60 bg-white/40 dark:bg-blue-900/20">
                <summary className="cursor-pointer select-none px-3 py-2 font-semibold list-none flex items-center gap-2 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 rounded">
                  <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  その他（表紙・返戻・労保・雇保育児系・共通動作）
                </summary>
                <ul className="space-y-1 px-3 pb-3 pt-1 ml-2">
                  <li className="font-semibold pt-1">表紙・返戻（XML→PDF 変換）</li>
                  <li className="ml-4">• 表紙 (kagami.xml) → {'{事業主名}様_日本年金機構からのお知らせ.pdf'}</li>
                  <li className="ml-4">• 返戻のお知らせ (henrei.xml) → {'{名前}様他N名_返戻のお知らせ.pdf'}（複数名統合）</li>

                  <li className="font-semibold pt-3">[労保]系（既存PDFを固定名にリネーム・会社単位）</li>
                  <li className="ml-4">• [労保]年度更新 / 年度更新(建設) → 令和{'{n}'}年度_労働保険概算・確定保険料申告書(建設).pdf</li>
                  <li className="ml-4">• [労保]保険関係成立届 → 労働保険関係成立届.pdf</li>
                  <li className="ml-4">• [労保]名称所在地変更 → 労働保険名称所在地変更届.pdf</li>
                  <li className="ml-4">• [労保]概算保険料申告(継続) → 労働保険概算保険料申告書.pdf</li>

                  <li className="font-semibold pt-3">[雇保]育児系給付（既存PDFリネーム）</li>
                  <li className="ml-4">• 育児休業出生後休業給付 / 育児時短就業給付 / 育児休業出生時休業給付</li>
                  <li className="ml-4">• 数字で始まる既存PDFを {'{被保険者名}様_{元の通知書名}.pdf'} にリネーム</li>

                  <li className="font-semibold pt-3">共通動作</li>
                  <li className="ml-4">• ネストされたZIPにも対応</li>
                  <li className="ml-4">• 旧バージョン出力PDF（元号略号始まりの日付プレフィックス）は自動除外（重複防止）</li>
                  <li className="ml-4">• OSのパス長切り詰めで手続き種別が「・・・」で途切れたフォルダ名にも対応</li>
                </ul>
              </details>

              {/* 凡例 */}
              <div className="text-xs text-blue-800/80 dark:text-blue-200/80 pt-2 px-1">
                <span className="text-green-700 dark:text-green-400 font-semibold">✓</span> 自動処理あり / <span className="text-amber-700 dark:text-amber-400 font-semibold">✗</span> 自動処理なし（既存PDFは元名のまま残置）
              </div>
            </div>
          </div>
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}