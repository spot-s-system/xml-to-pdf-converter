"use client";

import { useCallback, useState } from "react";
import { Card } from "@/components/ui/card";
import { Upload, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FileDropzoneProps {
  onFileSelect: (file: File) => void;
  accept: string;
  label: string;
  selectedFile?: File | null;
  onClear?: () => void;
}

export function FileDropzone({
  onFileSelect,
  accept,
  label,
  selectedFile,
  onClear,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        const extension = file.name.split(".").pop()?.toLowerCase();
        const acceptedExtensions = accept.split(",").map((ext) =>
          ext.trim().replace(".", "").replace("*", "")
        );

        if (
          acceptedExtensions.some(
            (ext) => ext === extension || ext === file.type.split("/")[1]
          )
        ) {
          onFileSelect(file);
        }
      }
    },
    [accept, onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onFileSelect(e.target.files[0]);
      }
    },
    [onFileSelect]
  );

  return (
    <div className="w-full">
      <label className="block text-sm font-medium mb-2">{label}</label>
      {selectedFile ? (
        <Card className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-sm font-medium">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(2)} KB
              </p>
            </div>
          </div>
          {onClear && (
            <Button variant="ghost" size="icon" onClick={onClear}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </Card>
      ) : (
        <Card
          className={`border-2 border-dashed transition-colors cursor-pointer ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50"
          }`}
          onDragEnter={handleDragIn}
          onDragLeave={handleDragOut}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <label className="flex flex-col items-center justify-center p-8 cursor-pointer">
            <Upload
              className={`h-10 w-10 mb-4 ${
                isDragging ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <p className="text-sm font-medium mb-1">
              ドラッグ&ドロップまたはクリックしてファイルを選択
            </p>
            <p className="text-xs text-muted-foreground">{accept}ファイル</p>
            <input
              type="file"
              accept={accept}
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
        </Card>
      )}
    </div>
  );
}
