"use client";

import { useState, useRef, useEffect } from "react";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileText, Download, AlertCircle, Terminal, Copy, CheckCircle } from "lucide-react";

export default function Home() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // 自動スクロール
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

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

  const handleConvert = async () => {
    if (!zipFile) {
      setError("ZIPファイルを選択してください");
      return;
    }

    setIsConverting(true);
    setProgress(0);
    setError(null);
    setLogs([]);

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

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));

              if (data.log) {
                setLogs(prev => [...prev, data.log]);
                // プログレスを更新（ログメッセージに基づく簡易的な計算）
                setProgress(prev => Math.min(prev + 5, 90));
              } else if (data.error) {
                setError(data.error);
                setIsConverting(false);
              } else if (data.complete) {
                setProgress(100);

                // Base64データからBlobを作成してダウンロード
                if (data.downloadUrl) {
                  const [dataUrl, filename] = data.downloadUrl.split('#');
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
                }

                // リセット
                setTimeout(() => {
                  setProgress(0);
                  setIsConverting(false);
                }, 1000);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <FileText className="h-10 w-10 text-primary" />
            <h1 className="text-4xl font-bold">公文書ZIP to PDF変換</h1>
          </div>
          <p className="text-muted-foreground">
            公文書ZIPファイルをアップロードして、個別PDFを含むZIPファイルを生成
          </p>
        </div>

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

            {error && (
              <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            {isConverting && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>変換中...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
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

        {/* リアルタイムログ（アップロードカードの下に表示） */}
        {(logs.length > 0 || isConverting) && (
          <Card className="shadow-lg mt-6">
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

        {/* 使い方 */}
        <div className="mt-8 p-6 bg-white dark:bg-slate-800 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-3">使い方</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>公文書ZIPファイルをドラッグ&ドロップまたはクリックして選択</li>
            <li>「一括変換」ボタンをクリック</li>
            <li>処理状況がリアルタイムでログに表示されます</li>
            <li>変換されたPDFが自動的にダウンロードされます</li>
          </ol>

          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <h3 className="text-sm font-semibold mb-2 text-blue-900 dark:text-blue-100">
              対応フォーマット
            </h3>
            <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <li>• 標準報酬決定通知書 (7130001.xml)</li>
              <li>• 標準報酬改定通知書 (7140001.xml)</li>
              <li>• 70歳以上被用者通知 (7200001.xml)</li>
              <li>• 返戻票 (henrei.xml)</li>
              <li>• ネストされたZIPにも対応</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}