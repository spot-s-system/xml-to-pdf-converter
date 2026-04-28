/**
 * 一括ZIP処理ロジック
 * 複数フォルダを含むZIPファイルを処理し、PDF変換後のZIPを生成
 */

import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import JSZip from 'jszip';
import { detectProcedureType } from './procedure-detector';
import { extractNamingInfo, NamingInfo } from './xml-info-extractor';
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
  folderPath: string; // フォルダの実際のパス（ネストされたZIPの一時ディレクトリにも対応）
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

  // 1.5. ルートレベルのネストされたZIPファイルを処理
  const rootZipFiles = rootFiles.filter((file) => path.extname(file).toLowerCase() === '.zip');

  for (const zipFile of rootZipFiles) {
    const zipPath = path.join(extractPath, zipFile);
    const zipBuffer = await fs.readFile(zipPath);

    try {
      // ZIPを展開
      const nestedZip = await JSZip.loadAsync(zipBuffer);
      const tempNestedPath = await fs.mkdtemp(path.join(tmpdir(), 'nested-root-'));

      // ファイルを展開
      const nestedFiles: string[] = [];
      for (const [relativePath, zipEntry] of Object.entries(nestedZip.files)) {
        if (!zipEntry.dir) {
          const content = await zipEntry.async('nodebuffer');
          const targetPath = path.join(tempNestedPath, path.basename(relativePath));
          await fs.writeFile(targetPath, content);
          nestedFiles.push(path.basename(relativePath));
        }
      }

      // ドキュメントペアを検出
      const documents = await detectDocumentPairs(tempNestedPath, nestedFiles);

      if (documents.length > 0) {
        const xmlXslFiles = nestedFiles.filter((file) => {
          const ext = path.extname(file).toLowerCase();
          return ext === '.xml' || ext === '.xsl';
        });

        const otherFiles = nestedFiles.filter((file) => {
          const ext = path.extname(file).toLowerCase();
          return ext !== '.xml' && ext !== '.xsl';
        });

        // ZIPファイル名（拡張子なし）をフォルダ名として使用
        const folderName = path.basename(zipFile, '.zip');

        folders.push({
          folderName,
          folderPath: tempNestedPath,
          documents,
          xmlXslFiles,
          otherFiles,
        });

        logIndent(`Extracted nested ZIP at root: ${zipFile}`, 1, '📦');
      }
    } catch (error) {
      logIndent(`Failed to process nested ZIP ${zipFile}: ${error}`, 1, '⚠️');
    }
  }

  // 2. ディレクトリの処理
  const directories = entries.filter(e => e.isDirectory());

  // 数字で始まるフォルダを処理（アンダースコア有無は問わない）
  for (const entry of directories) {
    if (/^\d/.test(entry.name)) {
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
        folderPath: folder.folderPath,
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
        folderPath: folder.folderPath,
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
 * [社保]資格取得 / [社保]資格喪失 フォルダ向けの命名情報フォールバック
 *
 * 背景:
 *  - DataRoot形式XMLや一部のN7100001で被保険者名がXMLから抽出できないケースで
 *    ファイル名が「様_xxx」となる
 *  - DataRoot形式の喪失で <TITLE> が無い場合、通知書名がデフォルトの「通知書」になる
 *
 * 対策: フォルダ名 `{seq}_{会社名}_{被保険者名}_[社保]資格(取得|喪失)_...` から
 * 被保険者名と通知書名を補完する。
 */
function applyShahoFolderNameFallbacks(
  info: NamingInfo,
  folderName: string
): NamingInfo {
  const m = folderName.match(/\[社保\]資格(取得|喪失)/);
  if (!m) return info;
  const subType = m[1] as '取得' | '喪失';

  const expectedTitle =
    subType === '取得'
      ? '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書'
      : '健康保険・厚生年金保険資格喪失確認通知書';

  // 通知書名: 空 or デフォルトフォールバック「通知書」のときに上書き
  const titleNeedsFix = !info.noticeTitle || info.noticeTitle === '通知書';
  const fixedTitle = titleNeedsFix ? expectedTitle : info.noticeTitle;

  // 被保険者名: フォルダ名3番目のフィールドから取得（スペース除去）
  const folderInsurerMatch = folderName.match(/^\d{4}_[^_]+_([^_]+)_/);
  const folderInsurerName = folderInsurerMatch
    ? folderInsurerMatch[1].replace(/\s+/g, '')
    : '';

  // allInsurersの空名前を埋める
  const fixedAllInsurers = (info.allInsurers ?? []).map((insurer) => ({
    ...insurer,
    name: insurer.name && insurer.name.trim() ? insurer.name : folderInsurerName,
  }));

  // 完全に空の場合はフォルダ名から1人作る
  if (fixedAllInsurers.length === 0 && folderInsurerName) {
    fixedAllInsurers.push({ name: folderInsurerName });
  }

  return {
    ...info,
    firstInsurerName:
      info.firstInsurerName && info.firstInsurerName.trim()
        ? info.firstInsurerName
        : folderInsurerName,
    insurerCount: Math.max(info.insurerCount ?? 0, fixedAllInsurers.length),
    allInsurers: fixedAllInsurers,
    noticeTitle: fixedTitle,
  };
}

/**
 * 1つのフォルダ内のドキュメントをPDF化
 */
export async function processFolderDocuments(
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

    // 命名情報を抽出（フォルダ名ベースのフォールバック適用）
    const rawNamingInfo = extractNamingInfo(
      xmlContent,
      procedureInfo.type,
      kagazmiXmlContent
    );
    const namingInfo = applyShahoFolderNameFallbacks(
      rawNamingInfo,
      folder.folderName
    );

    // PDF生成戦略に応じて処理を分岐
    if (
      procedureInfo.pdfStrategy === 'individual' &&
      namingInfo.allInsurers &&
      namingInfo.allInsurers.length >= 1
    ) {
      // 個別PDF生成（取得・喪失の場合）
      const pdfCount = namingInfo.allInsurers.length;
      const pdfLabel = pdfCount === 1 ? 'PDF' : 'PDFs';
      logIndent(`Generating ${pdfCount} individual ${pdfLabel}...`, 3);

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
 *
 * 対象手続き（フォルダ名に含まれていれば対象）:
 *   - [雇保]資格取得
 *   - [雇保]資格喪失（「離職票交付あり」サブパターン含む）
 *
 * パターン: {番号}_{会社名}_{被保険者名}_{手続き種別}...
 * 例:
 *   "0013_株式会社1SEC_川村 夏菜_[雇保]資格喪失(離職票交付あり)_..." → "川村夏菜"
 *   "0014_株式会社1SEC_濱中 広宣_[雇保]資格取得_..."             → "濱中広宣"
 */
function extractInsurerNameFromFolderName(folderName: string): string | null {
  const isYakuhoTarget =
    /\[雇保\]資格取得/.test(folderName) || /\[雇保\]資格喪失/.test(folderName);
  if (!isYakuhoTarget) return null;

  // パターン: 4桁の番号_会社名_被保険者名_...
  const match = folderName.match(/^\d{4}_[^_]+_([^_]+)_/);
  if (match) {
    // 被保険者名を抽出し、スペースを削除
    return match[1].replace(/\s+/g, '');
  }
  return null;
}

/**
 * フォルダ名から「[労保]年度更新公文書」のリネーム情報を抽出
 *
 * 対象パターン:
 *   {seq}_{company}_[労保]年度更新{?(建設)}_{14桁以上の年月日時刻}_公文書_{n}
 * 例:
 *   0001_xxx_[労保]年度更新_202507071232247301_公文書_4 → 令和7年（建設なし）
 *   0011_xxx_[労保]年度更新(建設)_202507031133539941_公文書_2 → 令和7年（建設あり）
 *
 * 「コメント」フォルダはリネーム対象外なのでnullを返す。
 */
function extractRoudouHokenKoubunshoInfo(
  folderName: string
): { reiwaYear: number; isKensetsu: boolean } | null {
  const match = folderName.match(
    /\[労保\]年度更新(\(建設\))?_(\d{4})\d{10,}_公文書_/
  );
  if (!match) return null;
  const seireki = parseInt(match[2], 10);
  const reiwa = seireki - 2018; // 2019 = 令和元年(1)
  if (reiwa < 1) return null;
  return { reiwaYear: reiwa, isKensetsu: !!match[1] };
}

/**
 * [労保]系の公文書フォルダで固定名にリネームするマッピング
 *
 * 対象は「公文書」フォルダのみ（コメントフォルダは対象外）。
 * 必要に応じてエントリを追加してください。
 */
const ROUDOUHOKEN_FIXED_NAME_MAP: Array<{
  pattern: RegExp;
  fileName: string;
}> = [
  { pattern: /\[労保\]保険関係成立届/, fileName: '労働保険関係成立届.pdf' },
  { pattern: /\[労保\]名称所在地変更/, fileName: '労働保険名称所在地変更届.pdf' },
  { pattern: /\[労保\]概算保険料申告\(継続\)/, fileName: '労働保険概算保険料申告書.pdf' },
];

function getRoudouHokenFixedFilename(folderName: string): string | null {
  if (!/_公文書_/.test(folderName)) return null;
  for (const { pattern, fileName } of ROUDOUHOKEN_FIXED_NAME_MAP) {
    if (pattern.test(folderName)) return fileName;
  }
  return null;
}

/**
 * PDFファイル名を必要に応じてリネーム
 *
 * リネームルール（優先順）:
 *   1. [労保]年度更新の公文書フォルダ:
 *        フォルダ内の **全PDF** を `令和{n}年度_労働保険概算・確定保険料申告書{(建設)?}.pdf` に統一
 *        （元ファイル名の形式は問わない）
 *   2. [労保]系の固定名マッピング（保険関係成立届、名称所在地変更...）:
 *        フォルダ内の **全PDF** をマッピング先の固定ファイル名に統一
 *   3. [雇保]資格取得 / [雇保]資格喪失（離職票交付あり含む）フォルダ:
 *        数字で始まるPDFの数字部分を被保険者名で置換し「{name}様_」を付与
 *   4. それ以外:
 *        そのまま
 */
function renamePdfIfNeeded(fileName: string, folderName: string): string {
  if (!fileName.toLowerCase().endsWith('.pdf')) return fileName;

  // ルール1: 労働保険年度更新（公文書）— ファイル名形式は問わない
  const roudouHoken = extractRoudouHokenKoubunshoInfo(folderName);
  if (roudouHoken) {
    const suffix = roudouHoken.isKensetsu ? '(建設)' : '';
    return `令和${roudouHoken.reiwaYear}年度_労働保険概算・確定保険料申告書${suffix}.pdf`;
  }

  // ルール2: 労保系の固定名（保険関係成立届/名称所在地変更/...）— ファイル名形式は問わない
  const fixedName = getRoudouHokenFixedFilename(folderName);
  if (fixedName) {
    return fixedName;
  }

  // ルール3: 雇用保険 資格取得/喪失 — 数字で始まるPDFのみ
  const numericPrefixMatch = fileName.match(/^\d+_(.+)$/);
  if (numericPrefixMatch) {
    const insurerName = extractInsurerNameFromFolderName(folderName);
    if (insurerName) {
      return `${insurerName}様_${numericPrefixMatch[1]}`;
    }
  }

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

    if (folder.success && folder.pdfs) {
      // PDFを追加
      for (const pdf of folder.pdfs) {
        zip.file(`${folderPrefix}${pdf.name}`, pdf.buffer);
      }

      // 元のXML/XSLファイルをコピー
      if (folder.xmlXslFiles) {
        for (const fileName of folder.xmlXslFiles) {
          // folderPathを使用（ネストされたZIPの一時ディレクトリにも対応）
          const sourcePath = path.join(folder.folderPath, fileName);

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
          // folderPathを使用（ネストされたZIPの一時ディレクトリにも対応）
          const sourcePath = path.join(folder.folderPath, fileName);

          try {
            const fileBuffer = await fs.readFile(sourcePath);

            // PDFファイルの場合、必要に応じてリネーム
            const targetFileName = renamePdfIfNeeded(fileName, folder.folderName);

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
 * フォルダ単位の進捗コールバック
 */
export interface ProcessProgress {
  onLog?: (message: string) => void;
  onFolderStart?: (index: number, total: number, folderName: string) => void;
  onFolderComplete?: (
    index: number,
    total: number,
    folderName: string,
    success: boolean,
    pdfCount: number,
    error?: string
  ) => void;
}

/**
 * フォルダ群を処理しながら逐次JSZipに追加する（メモリ効率版）
 *
 * 旧来の processFolders + createResultZip の合成版。
 * - 生成PDFはディスクに即書き出し、JSZipにはReadStream参照のみ保持 → Buffer即解放
 * - 元のXML/XSL/その他ファイルもReadStreamでJSZipに渡し、メモリ常駐させない
 * - 大きな中間Bufferを作らないことでRender無料枠（512MB）の枯渇を防ぐ
 */
export async function processFoldersToZip(
  folders: FolderStructure[],
  extractPath: string,
  callbacks?: ProcessProgress
): Promise<JSZip> {
  const zip = new JSZip();
  const total = folders.length;

  // 生成PDF一時格納先（extractPath配下に作るので最終クリーンアップで一緒に消える）
  const intermediatePdfDir = path.join(extractPath, '__generated_pdfs__');
  await fs.mkdir(intermediatePdfDir, { recursive: true });

  let pdfCounter = 0;

  for (let i = 0; i < total; i++) {
    const folder = folders[i];
    const folderNumber = i + 1;
    callbacks?.onFolderStart?.(i, total, folder.folderName);
    callbacks?.onLog?.(
      `[${folderNumber}/${total}] 📁 Processing: ${truncateFileName(folder.folderName, 50)}`
    );

    const isRootFolder = folder.folderName === 'root';
    const folderPrefix = isRootFolder ? '' : `${folder.folderName}/`;

    try {
      // PDF生成
      let generated: GeneratedPdf[] | null = await processFolderDocuments(folder);
      const pdfCount = generated.length;

      // 各PDFをディスクに書き出してJSZipにはReadStreamのみ追加し、Bufferを即解放する
      for (const pdf of generated) {
        const tmpPdfPath = path.join(intermediatePdfDir, `${pdfCounter++}.pdf`);
        await fs.writeFile(tmpPdfPath, pdf.buffer);
        zip.file(`${folderPrefix}${pdf.name}`, createReadStream(tmpPdfPath));
      }
      // ローカル参照を破棄してV8がBufferをGCできるようにする
      generated = null;

      // 元のXML/XSLファイル（ストリームでZIPに流し込む）
      if (folder.xmlXslFiles) {
        for (const fileName of folder.xmlXslFiles) {
          const sourcePath = path.join(folder.folderPath, fileName);
          try {
            await fs.access(sourcePath);
            zip.file(`${folderPrefix}${fileName}`, createReadStream(sourcePath));
          } catch (error) {
            console.error(`Failed to copy XML/XSL file ${fileName}:`, error);
          }
        }
      }

      // その他ファイル（PDFはリネーム適用）
      if (folder.otherFiles) {
        for (const fileName of folder.otherFiles) {
          const sourcePath = path.join(folder.folderPath, fileName);
          try {
            await fs.access(sourcePath);
            const targetFileName = renamePdfIfNeeded(fileName, folder.folderName);
            if (targetFileName !== fileName) {
              callbacks?.onLog?.(
                `[${folderNumber}/${total}]   ✏️ Renamed: ${truncateFileName(fileName, 40)} → ${truncateFileName(targetFileName, 50)}`
              );
            }
            zip.file(`${folderPrefix}${targetFileName}`, createReadStream(sourcePath));
          } catch (error) {
            console.error(`Failed to copy file ${fileName}:`, error);
          }
        }
      }

      callbacks?.onFolderComplete?.(i, total, folder.folderName, true, pdfCount);
      callbacks?.onLog?.(
        `[${folderNumber}/${total}] ✅ Completed: ${pdfCount} PDFs generated`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      const errorContent = `PDFの変換中にエラーが発生しました\n\nフォルダ: ${folder.folderName}\nエラー内容: ${errorMessage}\n\n対処方法:\n1. 元のZIPファイルの内容を確認してください\n2. 不足しているファイルを追加して再度アップロードしてください`;
      zip.file(`${folderPrefix}変換エラー.txt`, errorContent);
      callbacks?.onFolderComplete?.(i, total, folder.folderName, false, 0, errorMessage);
      callbacks?.onLog?.(`[${folderNumber}/${total}] ❌ Error: ${errorMessage}`);
    }
  }

  // ルート直下のファイル（Excel等）
  const rootEntries = await fs.readdir(extractPath, { withFileTypes: true });
  for (const file of rootEntries) {
    if (file.isFile()) {
      const filePath = path.join(extractPath, file.name);
      zip.file(file.name, createReadStream(filePath));
    }
  }

  return zip;
}

/**
 * JSZipをディスク上の一時ファイルにストリーム書き出し
 * - 巨大なzipをメモリ上にBuffer化しないことでピークメモリを大幅削減
 * - 戻り値: 書き出した一時ファイルの絶対パス
 */
export async function streamZipToTempFile(zip: JSZip): Promise<string> {
  const { createWriteStream } = await import('fs');
  const outPath = path.join(tmpdir(), `bulk-result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);

  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(outPath);
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    writeStream.on('finish', settleResolve);
    writeStream.on('error', settleReject);

    zip
      .generateNodeStream({
        type: 'nodebuffer',
        streamFiles: true,
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })
      .on('error', settleReject)
      .pipe(writeStream);
  });

  return outPath;
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
