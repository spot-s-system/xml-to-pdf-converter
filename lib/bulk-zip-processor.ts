/**
 * 一括ZIP処理ロジック
 * 複数フォルダを含むZIPファイルを処理し、PDF変換後のZIPを生成
 */

import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import JSZip from 'jszip';
import { detectProcedureType } from './procedure-detector';
import { extractNamingInfo } from './xml-info-extractor';
import { generateSafePdfFileName, generateIndividualPdfFileName } from './pdf-naming';
import { applyXsltTransformation } from './xslt-processor';
import { generatePdfFromHtml } from './pdf-generator';
import { optimizeXslForPdf } from './xsl-adjuster';
import {
  log,
  logIndent,
  logError,
  logWarning,
  formatDuration,
  createProgressBar,
  truncateFileName,
} from './logger';

export interface DocumentPair {
  type: 'kagami' | 'notification';
  xmlPath: string;
  xslPath: string;
  xmlFileName: string;
  xslFileName: string;
}

export interface FolderStructure {
  folderName: string;
  folderPath: string;
  documents: DocumentPair[];
  xmlXslFiles: string[]; // 元のXML/XSLファイル（相対パス）
  otherFiles: string[]; // PDFやTXTなど（相対パス）
}

export interface GeneratedPdf {
  name: string;
  buffer: Buffer;
}

export interface ProcessedFolder {
  folderName: string;
  success: boolean;
  pdfs?: GeneratedPdf[];
  xmlXslFiles?: string[];
  otherFiles?: string[];
  error?: string;
}

/**
 * ZIPファイルを解凍して一時ディレクトリに展開
 */
export async function extractZipFile(
  zipBuffer: Buffer
): Promise<string> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const extractPath = await fs.mkdtemp(path.join(tmpdir(), 'bulk-zip-'));

  // すべてのファイルを展開
  const promises = Object.keys(zip.files).map(async (relativePath) => {
    const file = zip.files[relativePath];
    const targetPath = path.join(extractPath, relativePath);

    if (file.dir) {
      // ディレクトリを作成
      await fs.mkdir(targetPath, { recursive: true });
    } else {
      // ファイルを書き込み
      const content = await file.async('nodebuffer');
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content);
    }
  });

  await Promise.all(promises);
  return extractPath;
}

/**
 * フォルダ構造を分析（ネストされたZIPも処理）
 */
export async function analyzeFolderStructure(
  extractPath: string
): Promise<FolderStructure[]> {
  const folders: FolderStructure[] = [];
  const entries = await fs.readdir(extractPath, { withFileTypes: true });

  // 1. ルートレベルのXML/XSLファイルをチェック
  const rootFiles = await fs.readdir(extractPath);
  const rootXmlXslFiles = rootFiles.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return ext === '.xml' || ext === '.xsl';
  });

  // ルートにXML/XSLファイルがある場合、仮想的な"root"フォルダとして処理
  if (rootXmlXslFiles.length > 0) {
    const documents = await detectDocumentPairs(extractPath, rootFiles);

    if (documents.length > 0) {
      const otherFiles = rootFiles.filter((file) => {
        const ext = path.extname(file).toLowerCase();
        // XML/XSLファイルとディレクトリを除外
        return ext !== '.xml' && ext !== '.xsl' && !entries.some(e => e.isDirectory() && e.name === file);
      });

      folders.push({
        folderName: 'root',
        folderPath: extractPath,
        documents,
        xmlXslFiles: rootXmlXslFiles,
        otherFiles,
      });

      logIndent('Found XML/XSL files in root directory', 1, 'ℹ️');
    }
  }

  // 2. ディレクトリの処理
  const directories = entries.filter(e => e.isDirectory());

  // 数字4桁で始まるフォルダを処理（既存の処理）
  for (const entry of directories) {
    if (/^\d{4}_/.test(entry.name)) {
      const folderPath = path.join(extractPath, entry.name);
      const files = await fs.readdir(folderPath);

      // ネストされたZIPファイルを検出して展開
      const nestedZips = files.filter((file) =>
        path.extname(file).toLowerCase() === '.zip'
      );

      const extractedXmlXslFiles: string[] = [];
      const extractedDocuments: DocumentPair[] = [];

      if (nestedZips.length > 0) {
        logIndent(`Found ${nestedZips.length} nested ZIP(s) in ${truncateFileName(entry.name, 40)}`, 2, '📦');

        for (const nestedZipFile of nestedZips) {
          const nestedZipPath = path.join(folderPath, nestedZipFile);

          try {
            // ネストされたZIPを読み込んで展開
            const nestedZipBuffer = await fs.readFile(nestedZipPath);
            const nestedZip = await JSZip.loadAsync(nestedZipBuffer);

            // XML/XSLファイルを一時的に展開
            const tempNestedPath = await fs.mkdtemp(path.join(tmpdir(), 'nested-'));
            const nestedFiles: string[] = [];

            for (const [relativePath, zipEntry] of Object.entries(nestedZip.files)) {
              if (!zipEntry.dir) {
                const ext = path.extname(relativePath).toLowerCase();
                if (ext === '.xml' || ext === '.xsl') {
                  const content = await zipEntry.async('nodebuffer');
                  const targetPath = path.join(tempNestedPath, path.basename(relativePath));
                  await fs.writeFile(targetPath, content);
                  nestedFiles.push(path.basename(relativePath));
                  extractedXmlXslFiles.push(path.basename(relativePath));
                }
              }
            }

            // ネストされたZIP内のドキュメントペアを検出
            const nestedDocs = await detectDocumentPairs(tempNestedPath, nestedFiles);

            // パスを修正（実際のフォルダパスを使用）
            for (const doc of nestedDocs) {
              doc.xmlPath = path.join(tempNestedPath, path.basename(doc.xmlPath));
              doc.xslPath = path.join(tempNestedPath, path.basename(doc.xslPath));
            }

            extractedDocuments.push(...nestedDocs);

            logIndent(`Extracted ${nestedFiles.length} XML/XSL files from ${truncateFileName(nestedZipFile, 30)}`, 3, '✓');
          } catch (error) {
            logIndent(`Failed to process nested ZIP: ${nestedZipFile}`, 3, '❌');
            console.error(error);
          }
        }
      }

      // 通常のXML/XSLペアを検出
      const normalDocuments = await detectDocumentPairs(folderPath, files);

      // ネストされたZIPから抽出したドキュメントと通常のドキュメントを結合
      const allDocuments = [...normalDocuments, ...extractedDocuments];

      // 元のXML/XSLファイルをリストアップ（ネストZIPから抽出したものを含む）
      const xmlXslFiles = files.filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return ext === '.xml' || ext === '.xsl';
      }).concat(extractedXmlXslFiles);

      // その他のファイル（PDF、TXT、CSV等）をリストアップ
      const otherFiles = files.filter((file) => {
        const ext = path.extname(file).toLowerCase();
        // XMLとXSLは除外、他のファイルを保持
        if (ext === '.xml' || ext === '.xsl') {
          return false;
        }
        return true;
      });

      folders.push({
        folderName: entry.name,
        folderPath,
        documents: allDocuments,
        xmlXslFiles,
        otherFiles,
      });
    }
  }

  // 3. 単一フォルダの場合の処理（数字で始まらないフォルダも対応）
  // ルートにファイルがなく、番号付きフォルダも見つからず、フォルダが1つだけの場合
  if (folders.length === 0 && directories.length === 1) {
    const singleDir = directories[0];
    const folderPath = path.join(extractPath, singleDir.name);
    const files = await fs.readdir(folderPath);

    // ネストされたZIPファイルを検出して展開
    const nestedZips = files.filter((file) =>
      path.extname(file).toLowerCase() === '.zip'
    );

    const extractedXmlXslFiles: string[] = [];
    const extractedDocuments: DocumentPair[] = [];

    if (nestedZips.length > 0) {
      logIndent(`Found ${nestedZips.length} nested ZIP(s) in single folder`, 2, '📦');

      for (const nestedZipFile of nestedZips) {
        const nestedZipPath = path.join(folderPath, nestedZipFile);

        try {
          // ネストされたZIPを読み込んで展開
          const nestedZipBuffer = await fs.readFile(nestedZipPath);
          const nestedZip = await JSZip.loadAsync(nestedZipBuffer);

          // XML/XSLファイルを一時的に展開
          const tempNestedPath = await fs.mkdtemp(path.join(tmpdir(), 'nested-'));
          const nestedFiles: string[] = [];

          for (const [relativePath, zipEntry] of Object.entries(nestedZip.files)) {
            if (!zipEntry.dir) {
              const ext = path.extname(relativePath).toLowerCase();
              if (ext === '.xml' || ext === '.xsl') {
                const content = await zipEntry.async('nodebuffer');
                const targetPath = path.join(tempNestedPath, path.basename(relativePath));
                await fs.writeFile(targetPath, content);
                nestedFiles.push(path.basename(relativePath));
                extractedXmlXslFiles.push(path.basename(relativePath));
              }
            }
          }

          // ネストされたZIP内のドキュメントペアを検出
          const nestedDocs = await detectDocumentPairs(tempNestedPath, nestedFiles);

          // パスを修正（実際のフォルダパスを使用）
          for (const doc of nestedDocs) {
            doc.xmlPath = path.join(tempNestedPath, path.basename(doc.xmlPath));
            doc.xslPath = path.join(tempNestedPath, path.basename(doc.xslPath));
          }

          extractedDocuments.push(...nestedDocs);

          logIndent(`Extracted ${nestedFiles.length} XML/XSL files from ${truncateFileName(nestedZipFile, 30)}`, 3, '✓');
        } catch (error) {
          logIndent(`Failed to process nested ZIP: ${nestedZipFile}`, 3, '❌');
          console.error(error);
        }
      }
    }

    // 通常のXML/XSLペアを検出
    const normalDocuments = await detectDocumentPairs(folderPath, files);

    // ネストされたZIPから抽出したドキュメントと通常のドキュメントを結合
    const allDocuments = [...normalDocuments, ...extractedDocuments];

    if (allDocuments.length > 0) {
      const xmlXslFiles = files.filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return ext === '.xml' || ext === '.xsl';
      }).concat(extractedXmlXslFiles);

      const otherFiles = files.filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return ext !== '.xml' && ext !== '.xsl';
      });

      folders.push({
        folderName: singleDir.name,
        folderPath,
        documents: allDocuments,
        xmlXslFiles,
        otherFiles,
      });

      logIndent(`Processing single folder: ${truncateFileName(singleDir.name, 50)}`, 1, 'ℹ️');
    }
  }

  return folders;
}

/**
 * XML/XSLペアを検出
 */
async function detectDocumentPairs(
  folderPath: string,
  files: string[]
): Promise<DocumentPair[]> {
  const pairs: DocumentPair[] = [];
  const xmlFiles = files.filter((f) => f.toLowerCase().endsWith('.xml'));
  const xslFiles = files.filter((f) => f.toLowerCase().endsWith('.xsl'));

  for (const xmlFile of xmlFiles) {
    const baseName = path.basename(xmlFile, path.extname(xmlFile));

    // kagami判定
    const isKagami = baseName.toLowerCase() === 'kagami' ||
                     /^\d{18}$/.test(baseName); // 到達番号形式

    // 対応するXSLを探す
    let xslFile: string | undefined;

    if (isKagami) {
      // kagami.xslを探す
      xslFile = xslFiles.find((f) =>
        path.basename(f, path.extname(f)).toLowerCase() === 'kagami'
      );
    } else {
      // 同名のXSLを探す
      xslFile = xslFiles.find(
        (f) => path.basename(f, path.extname(f)) === baseName
      );

      // DataRoot形式の場合、<STYLESHEET>タグからXSLファイル名を取得
      if (!xslFile) {
        const xmlContent = await fs.readFile(
          path.join(folderPath, xmlFile),
          'utf-8'
        );
        const stylesheetMatch = xmlContent.match(
          /<STYLESHEET>(.*?)<\/STYLESHEET>/
        );
        if (stylesheetMatch) {
          const stylesheetName = stylesheetMatch[1];
          xslFile = xslFiles.find((f) => f === stylesheetName);
        }

        // xml-stylesheet処理命令からも探す
        if (!xslFile) {
          const piMatch = xmlContent.match(
            /<\?xml-stylesheet[^>]*href="([^"]+)"/
          );
          if (piMatch) {
            const href = piMatch[1];
            xslFile = xslFiles.find((f) => f === href);
          }
        }
      }
    }

    if (xslFile) {
      pairs.push({
        type: isKagami ? 'kagami' : 'notification',
        xmlPath: path.join(folderPath, xmlFile),
        xslPath: path.join(folderPath, xslFile),
        xmlFileName: xmlFile,
        xslFileName: xslFile,
      });
    }
  }

  // kagamiを最初に配置
  pairs.sort((a, b) => {
    if (a.type === 'kagami' && b.type !== 'kagami') return -1;
    if (a.type !== 'kagami' && b.type === 'kagami') return 1;
    return 0;
  });

  return pairs;
}

/**
 * フォルダごとにPDFを生成
 */
export async function processFolders(
  folders: FolderStructure[]
): Promise<ProcessedFolder[]> {
  const results: ProcessedFolder[] = [];
  const totalFolders = folders.length;

  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    const folderNumber = i + 1;
    const progress = createProgressBar(folderNumber - 1, totalFolders);

    log(`${progress} Processing folder ${folderNumber}/${totalFolders}`, '📁');
    logIndent(truncateFileName(folder.folderName, 60), 1);

    const folderStartTime = Date.now();

    try {
      const pdfs = await processFolderDocuments(folder);
      const duration = formatDuration(Date.now() - folderStartTime);

      results.push({
        folderName: folder.folderName,
        success: true,
        pdfs,
        xmlXslFiles: folder.xmlXslFiles,
        otherFiles: folder.otherFiles,
      });

      logIndent(`✅ Completed: ${pdfs.length} PDFs generated (${duration})`, 1);
    } catch (error) {
      const duration = formatDuration(Date.now() - folderStartTime);
      logError(`Failed after ${duration}`, error);

      results.push({
        folderName: folder.folderName,
        success: false,
        error: error instanceof Error ? error.message : '不明なエラー',
      });
    }
  }

  return results;
}

/**
 * 個別被保険者のXMLを生成（社会保険形式）
 */
function generateIndividualInsurerXml(
  xmlContent: string,
  insurerBlock: string
): string {
  // 全被保険者ブロックを削除して、指定された被保険者ブロックのみを含めたXMLを生成
  const allInsurerBlocksRegex = /<_被保険者>[\s\S]*?<\/_被保険者>/g;
  const baseXml = xmlContent.replace(allInsurerBlocksRegex, '');

  // 指定された被保険者ブロックを挿入する位置を見つける
  // 通常は他のデータブロックの後、終了タグの前に挿入
  const rootTagMatch = baseXml.match(/<(N7\d{6})>/);
  if (rootTagMatch) {
    const rootTag = rootTagMatch[1];
    const closingTag = `</${rootTag}>`;
    const insertPosition = baseXml.lastIndexOf(closingTag);

    if (insertPosition > -1) {
      return (
        baseXml.slice(0, insertPosition) +
        insurerBlock +
        baseXml.slice(insertPosition)
      );
    }
  }

  // フォールバック：元のXMLを返す
  return xmlContent;
}

/**
 * 1つのフォルダ内のドキュメントをPDF化
 */
async function processFolderDocuments(
  folder: FolderStructure
): Promise<GeneratedPdf[]> {
  const pdfs: GeneratedPdf[] = [];
  let kagazmiXmlContent: string | undefined;

  // kagami.xmlの内容を先に読み込む（通知書名の取得に使用）
  const kagazmiDoc = folder.documents.find((d) => d.type === 'kagami');
  if (kagazmiDoc) {
    kagazmiXmlContent = await fs.readFile(kagazmiDoc.xmlPath, 'utf-8');
  }

  for (let docIndex = 0; docIndex < folder.documents.length; docIndex++) {
    const doc = folder.documents[docIndex];

    logIndent(`📄 Document ${docIndex + 1}/${folder.documents.length}: ${doc.xmlFileName}`, 2);

    // XMLとXSLを読み込み
    const xmlContent = await fs.readFile(doc.xmlPath, 'utf-8');
    const xslContent = await fs.readFile(doc.xslPath, 'utf-8');

    // 手続き種別を判定
    const procedureInfo = detectProcedureType(xmlContent);

    // 命名情報を抽出
    const namingInfo = extractNamingInfo(
      xmlContent,
      procedureInfo.type,
      kagazmiXmlContent
    );

    // PDF生成戦略に応じて処理を分岐
    if (
      procedureInfo.pdfStrategy === 'individual' &&
      namingInfo.allInsurers &&
      namingInfo.allInsurers.length > 1
    ) {
      // 個別PDF生成（取得・喪失で複数人の場合）
      logIndent(`Generating ${namingInfo.allInsurers.length} individual PDFs...`, 3);

      // 各被保険者のブロックを抽出
      const insurerBlocks = xmlContent.match(
        /<_被保険者>[\s\S]*?<\/_被保険者>/g
      );

      if (insurerBlocks && insurerBlocks.length === namingInfo.allInsurers.length) {
        // 各被保険者ごとにPDFを生成
        for (let i = 0; i < namingInfo.allInsurers.length; i++) {
          const insurer = namingInfo.allInsurers[i];
          logIndent(`- Processing ${insurer.name}様...`, 4);

          const individualXml = generateIndividualInsurerXml(
            xmlContent,
            insurerBlocks[i]
          );

          // XSLT変換
          const html = await applyXsltTransformation(individualXml, optimizeXslForPdf(xslContent));

          // PDF生成
          const pdfBuffer = await generatePdfFromHtml(html);

          // 個別PDFファイル名を生成
          const pdfFileName = generateIndividualPdfFileName(
            procedureInfo.type,
            insurer.name,
            namingInfo.noticeTitle
          );

          pdfs.push({
            name: pdfFileName,
            buffer: pdfBuffer,
          });

          logIndent(`✓ ${truncateFileName(pdfFileName, 50)}`, 4);
        }
      } else {
        // フォールバック：通常の連結PDF生成
        logWarning('Failed to extract individual insurer blocks, generating combined PDF');

        const pdfFileName = generateSafePdfFileName(
          procedureInfo.type,
          namingInfo
        );
        const html = await applyXsltTransformation(xmlContent, optimizeXslForPdf(xslContent));
        const pdfBuffer = await generatePdfFromHtml(html);
        pdfs.push({
          name: pdfFileName,
          buffer: pdfBuffer,
        });

        logIndent(`→ ${truncateFileName(pdfFileName, 50)} ✓`, 3);
      }
    } else {
      // 連結PDF生成（月額変更、算定基礎届、賞与、その他、または単独の場合）
      const pdfFileName = generateSafePdfFileName(
        procedureInfo.type,
        namingInfo
      );

      // XSLT変換
      const html = await applyXsltTransformation(xmlContent, optimizeXslForPdf(xslContent));

      // PDF生成
      const pdfBuffer = await generatePdfFromHtml(html);

      pdfs.push({
        name: pdfFileName,
        buffer: pdfBuffer,
      });

      logIndent(`→ ${truncateFileName(pdfFileName, 50)} ✓`, 3);
    }
  }

  return pdfs;
}

/**
 * フォルダ名から被保険者名を抽出
 * パターン: {番号}_{会社名}_{被保険者名}_{手続き種別}...
 * 例: "0013_株式会社1SEC_川村 夏菜_[雇保]資格喪失(離職票交付あり)_..." → "川村夏菜"
 *
 * 重要: 「離職票交付あり」がフォルダ名に含まれている場合のみ被保険者名を返す
 */
function extractInsurerNameFromFolderName(folderName: string): string | null {
  // 「離職票交付あり」が含まれていない場合は null を返す
  if (!folderName.includes('離職票交付あり')) {
    return null;
  }

  // パターン: 4桁の番号_会社名_被保険者名_...
  const match = folderName.match(/^\d{4}_[^_]+_([^_]+)_/);
  if (match) {
    // 被保険者名を抽出し、スペースを削除
    return match[1].replace(/\s+/g, '');
  }
  return null;
}

/**
 * PDFファイル名を必要に応じてリネーム
 * 数字で始まるPDFファイルの場合、数字部分を被保険者名に置き換える
 * 例: "2501793096_雇用保険被保険者資格喪失確認通知書.pdf" → "川村夏菜_雇用保険被保険者資格喪失確認通知書.pdf"
 */
function renamePdfIfNeeded(fileName: string, insurerName: string | null): string {
  // PDFファイルでない場合、または被保険者名がない場合はそのまま返す
  if (!fileName.toLowerCase().endsWith('.pdf') || !insurerName) {
    return fileName;
  }

  // 数字で始まるPDFファイルのみリネーム対象
  const match = fileName.match(/^\d+_(.+)$/);
  if (match) {
    // 数字部分を被保険者名に置き換え
    return `${insurerName}_${match[1]}`;
  }

  // パターンに合わない場合はそのまま返す
  return fileName;
}

/**
 * 変換結果をZIPファイルにまとめる
 */
export async function createResultZip(
  processedFolders: ProcessedFolder[],
  extractPath: string
): Promise<Buffer> {
  const zip = new JSZip();

  for (const folder of processedFolders) {
    // "root"フォルダの場合は特別扱い（ルートにファイルを配置）
    const isRootFolder = folder.folderName === 'root';
    const folderPrefix = isRootFolder ? '' : `${folder.folderName}/`;

    // フォルダ名から被保険者名を抽出（PDFリネーム用）
    const insurerName = extractInsurerNameFromFolderName(folder.folderName);

    if (folder.success && folder.pdfs) {
      // PDFを追加
      for (const pdf of folder.pdfs) {
        zip.file(`${folderPrefix}${pdf.name}`, pdf.buffer);
      }

      // 元のXML/XSLファイルをコピー
      if (folder.xmlXslFiles) {
        for (const fileName of folder.xmlXslFiles) {
          // rootフォルダの場合は extractPath 直下、それ以外は subfolder から読み込む
          const sourcePath = isRootFolder
            ? path.join(extractPath, fileName)
            : path.join(extractPath, folder.folderName, fileName);

          try {
            const fileBuffer = await fs.readFile(sourcePath);
            zip.file(`${folderPrefix}${fileName}`, fileBuffer);
          } catch (error) {
            console.error(`Failed to copy XML/XSL file ${fileName}:`, error);
          }
        }
      }

      // その他のファイルをコピー（PDFはリネーム処理を適用）
      if (folder.otherFiles) {
        for (const fileName of folder.otherFiles) {
          // rootフォルダの場合は extractPath 直下、それ以外は subfolder から読み込む
          const sourcePath = isRootFolder
            ? path.join(extractPath, fileName)
            : path.join(extractPath, folder.folderName, fileName);

          try {
            const fileBuffer = await fs.readFile(sourcePath);

            // PDFファイルの場合、必要に応じてリネーム
            const targetFileName = renamePdfIfNeeded(fileName, insurerName);

            zip.file(`${folderPrefix}${targetFileName}`, fileBuffer);
          } catch (error) {
            console.error(`Failed to copy file ${fileName}:`, error);
          }
        }
      }
    } else {
      // エラーが発生した場合、エラーファイルを配置
      const errorMessage = `PDFの変換中にエラーが発生しました\n\nフォルダ: ${folder.folderName}\nエラー内容: ${folder.error}\n\n対処方法:\n1. 元のZIPファイルの内容を確認してください\n2. 不足しているファイルを追加して再度アップロードしてください`;

      zip.file(`${folderPrefix}変換エラー.txt`, errorMessage);
    }
  }

  // ルートファイル（Excelなど）をコピー
  const rootFiles = await fs.readdir(extractPath, { withFileTypes: true });
  for (const file of rootFiles) {
    if (file.isFile()) {
      const filePath = path.join(extractPath, file.name);
      const fileBuffer = await fs.readFile(filePath);
      zip.file(file.name, fileBuffer);
    }
  }

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

/**
 * 一時ディレクトリをクリーンアップ
 */
export async function cleanupTempDirectory(tempPath: string): Promise<void> {
  try {
    await fs.rm(tempPath, { recursive: true, force: true });

    // ネストされたZIP用の一時ディレクトリもクリーンアップ
    const tmpDir = tmpdir();
    const tempDirs = await fs.readdir(tmpDir);
    const nestedTempDirs = tempDirs.filter(dir => dir.startsWith('nested-'));

    for (const dir of nestedTempDirs) {
      const dirPath = path.join(tmpDir, dir);
      try {
        await fs.rm(dirPath, { recursive: true, force: true });
      } catch {
        // エラーは無視（既に削除済みの可能性）
      }
    }
  } catch (error) {
    console.error(`Failed to cleanup temp directory ${tempPath}:`, error);
  }
}
