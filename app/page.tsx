"use client";

import { useState } from "react";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileText, Download, AlertCircle } from "lucide-react";

export default function Home() {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleConvert = async () => {
    if (!zipFile) {
      setError("ZIPファイルを選択してください");
      return;
    }

    setIsConverting(true);
    setProgress(0);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", zipFile);

      setProgress(20);

      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      setProgress(70);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "変換に失敗しました");
      }

      setProgress(90);

      // PDFをダウンロード
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${zipFile.name.replace(".zip", "")}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setProgress(100);

      // リセット
      setTimeout(() => {
        setProgress(0);
        setIsConverting(false);
      }, 1000);
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
            公文書ZIPファイルをアップロードして、自動的にPDFを生成
          </p>
        </div>

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
                  PDFに変換
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="mt-8 p-6 bg-white dark:bg-slate-800 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-3">使い方</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>公文書ZIPファイルをドラッグ&ドロップまたはクリックして選択</li>
            <li>「PDFに変換」ボタンをクリック</li>
            <li>ZIPが自動的に展開され、XML+XSLがPDFに変換されます</li>
            <li>変換されたPDFが自動的にダウンロードされます</li>
          </ol>

          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <h3 className="text-sm font-semibold mb-2 text-blue-900 dark:text-blue-100">対応フォーマット</h3>
            <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
              <li>• 標準報酬決定通知書 (7130001.xml)</li>
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
