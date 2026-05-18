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
  isShahoKoubunshoPdfFileName,
  splitShahoKoubunshoPdf,
  SplitPdfResult,
} from './koubunsho-pdf-splitter';
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
    // 到達番号形式: 公文書(通知書)フォルダは18桁 (例 202605080957403094.xml)、
    //              届出控(電子申請データの写し)フォルダは末尾に "00" 等が付いた
    //              20桁になる (例 20260508095740309400.xml)。どちらも kagami として
    //              扱わないと kagami本文ベースの届出控判定が効かない。
    const isKagami =
      baseName.toLowerCase() === 'kagami' ||
      /^\d{18,20}$/.test(baseName);

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
 * [社保]系の命名情報フォールバック対象マッピング（公文書／通知書版）
 *
 * フォルダ名のパターン（key）にマッチした場合、value の通知書名を
 * 既定タイトル（`通知書` 等）の代わりに使用する。
 * isPerCompany: true は会社単位の手続き（被保険者名を付与しない）。
 */
const SHAHO_TITLE_MAP: Array<{
  pattern: RegExp;
  title: string;
  isPerCompany?: boolean;
}> = [
  { pattern: /\[社保\]資格取得/,            title: '健康保険・厚生年金保険資格取得確認および標準報酬決定通知書' },
  { pattern: /\[社保\]資格喪失/,            title: '健康保険・厚生年金保険資格喪失確認通知書' },
  { pattern: /\[社保\]育児休業等申出書/,    title: '健康保険・厚生年金保険育児休業等取得者確認通知書' },
  { pattern: /\[社保\]産前産後休業等申出書/, title: '健康保険・厚生年金保険産前産後休業取得者確認通知書' },
  { pattern: /\[社保\]新規適用/,            title: '（社会保険）適用通知書', isPerCompany: true },
];

/**
 * 届出控（電子申請データの写し）フォルダの統一ファイル名
 *
 * 公文書（通知書）と届出控は同じフォルダ名パターン（`[社保]xxx`）を共有するため、
 * kagami本文の判定（[[isApplicationCopyFolder]]）で届出控と判定された場合は
 * 被保険者名・通知書名を一切付けず、シンプルに `届出控.pdf` に統一する。
 * （ユーザー要望: 届出控フォルダでは被保険者名は不要、ファイル名から
 *  この PDF が届出控だとひと目で分かれば十分）
 */
const APPLICATION_COPY_TITLE = '届出控';

/**
 * kagami の本文から「電子申請データの写し（届出控）」フォルダかを判定
 *
 * 公文書（通知書）と届出控（電子申請データの写し）はフォルダ名のパターンが同じで
 * 視覚的に区別できないため、kagami XML 本文の固有フレーズで切り分ける。
 *
 * 検出フレーズ（届出控 kagami の MAINTXT に含まれる）:
 *   - 「別添申請書の写しを送付いたしますので、申請内容をご確認ください。」
 *   - 「当機構が受理した電子申請データの写しをお返しするサービス」
 *
 * 通知書（公文書）の kagami にはこれらの表現は出てこない。
 */
export function isApplicationCopyFolder(
  kagamiXmlContent: string | undefined
): boolean {
  if (!kagamiXmlContent) return false;
  return /電子申請データの写し|申請書の写し/.test(kagamiXmlContent);
}

/**
 * [社保]系フォルダ向けの命名情報フォールバック
 *
 * 背景:
 *  - DataRoot形式XMLや一部のN7xxxxxで被保険者名がXMLから抽出できないケースで
 *    ファイル名が「様_xxx」となる
 *  - <TITLE> が無い／取得失敗時、通知書名がデフォルトの「通知書」になる
 *
 * 対策: フォルダ名 `{seq}_{会社名}_{被保険者名}_[社保]xxx_...` から
 * 被保険者名と通知書名を補完する（SHAHO_TITLE_MAPに対応するパターンがある場合のみ）。
 *
 * isApplicationCopy=true の場合は届出控版マップ（SHAHO_APPLICATION_COPY_TITLE_MAP）
 * を参照し、通知書名を「…(届出控)」に切り替える。
 */
export function applyShahoFolderNameFallbacks(
  info: NamingInfo,
  folderName: string,
  isApplicationCopy: boolean = false
): NamingInfo {
  // 届出控フォルダは被保険者名・通知書名を全て破棄して `届出控.pdf` に統一する。
  // SHAHO_TITLE_MAP の 5 パターン（取得・喪失・育休・産休・新規適用）には
  // 賞与支払 / 月額変更 / 算定基礎 / 扶養等が含まれないため、ここでは
  // [社保] 系のフォルダ全般を対象とする。
  // kagami 本文が「電子申請データの写し」等を含むことは isApplicationCopy で
  // すでに確認済なので、フォルダ実体が届出控であることは保証されている。
  if (isApplicationCopy) {
    if (!/\[社保\]/.test(folderName)) return info;
    return {
      ...info,
      firstInsurerName: '',
      insurerCount: 0,
      allInsurers: [],
      noticeTitle: APPLICATION_COPY_TITLE,
    };
  }

  let entry: { title: string; isPerCompany?: boolean } | null = null;
  for (const e of SHAHO_TITLE_MAP) {
    if (e.pattern.test(folderName)) {
      entry = { title: e.title, isPerCompany: e.isPerCompany };
      break;
    }
  }
  if (!entry) return info;

  // 通知書名: 空 or デフォルトフォールバック「通知書」のときに上書き
  const titleNeedsFix = !info.noticeTitle || info.noticeTitle === '通知書';
  const fixedTitle = titleNeedsFix ? entry.title : info.noticeTitle;

  // 会社単位の手続き: 被保険者名を付与しない（クリアして通知書名のみで生成）
  if (entry.isPerCompany) {
    return {
      ...info,
      firstInsurerName: '',
      insurerCount: 0,
      allInsurers: [],
      noticeTitle: fixedTitle,
    };
  }

  // 被保険者名: 手続きタグ `_[社保]xxx` の直前のフィールドから取得（前後trimのみ、内部スペース保持）
  // 4フィールド「seq_会社_名前_[社保]xxx」と5フィールド「seq_会社_番号_名前_[社保]xxx」の双方に対応
  // 手続きタグ以降の末尾 `_` は必須としない（OS等によるパス長切り詰めで末尾「・・・」になっても拾う）
  const folderInsurerMatch = folderName.match(/_([^_]+)_\[社保\]/);
  const folderInsurerName = folderInsurerMatch
    ? folderInsurerMatch[1].trim()
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
 * [社保]算定基礎 フォルダの個別PDFに「令和{n}年度算定_」プレフィックスを付与
 *
 * 対象: 7130001 / 7200001 から生成される個別PDF（pdfStrategy='individual'経路）
 * 年度: XMLの<適用年月>から元号略号「R{n}」のnを使用（算定基礎届は適用年月=9月のため、年=年度）
 * 適用年月が抽出できないケースは元のファイル名のまま返す。
 */
function applyShahoSanteiKisoYearPrefix(
  fileName: string,
  folderName: string,
  applicableDate: string | undefined
): string {
  if (!/\[社保\]算定基礎/.test(folderName)) return fileName;
  if (!applicableDate) return fileName;

  const match = applicableDate.match(/^R(\d+)年/);
  if (!match) return fileName;

  const year = parseInt(match[1], 10);
  return `令和${year}年度算定_${fileName}`;
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

  // kagami本文から「電子申請データの写し（届出控）」フォルダかを判定
  const isApplicationCopy = isApplicationCopyFolder(kagazmiXmlContent);
  if (isApplicationCopy) {
    logIndent('Detected application copy folder (届出控)', 2, 'ℹ️');
  }

  for (let docIndex = 0; docIndex < folder.documents.length; docIndex++) {
    const doc = folder.documents[docIndex];

    logIndent(`📄 Document ${docIndex + 1}/${folder.documents.length}: ${doc.xmlFileName}`, 2);

    // ドキュメント単位のtry/catchで、1つのXML/XSLペアの変換失敗が他のドキュメント
    // (kagamiや別の被保険者PDF) や元ファイルのコピー処理を巻き込まないようにする。
    // 例: 算定基礎の 7130001.xsl は xsl-adjuster の挿入CSS と相性が悪いケースが
    // あり、ここで例外を投げる。フォルダ単位で投げるとフォルダ全体が変換エラー扱いに
    // なるが、ドキュメント単位なら成功した分(kagamiなど)は保存できる。
    try {
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
        folder.folderName,
        isApplicationCopy
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
          // 各被保険者ごとにPDFを生成（1人分の失敗で他人を巻き込まないよう個別try/catch）
          for (let i = 0; i < namingInfo.allInsurers.length; i++) {
            const insurer = namingInfo.allInsurers[i];
            logIndent(`- Processing ${insurer.name}様...`, 4);

            try {
              const individualXml = generateIndividualInsurerXml(
                xmlContent,
                insurerBlocks[i]
              );

              // XSLT変換
              const html = await applyXsltTransformation(individualXml, optimizeXslForPdf(xslContent));

              // PDF生成
              const pdfBuffer = await generatePdfFromHtml(html);

              // 個別PDFファイル名を生成
              const baseFileName = generateIndividualPdfFileName(
                procedureInfo.type,
                insurer.name,
                namingInfo.noticeTitle
              );
              // [社保]算定基礎フォルダでは「令和{n}年度算定_」プレフィックスを付与
              const pdfFileName = applyShahoSanteiKisoYearPrefix(
                baseFileName,
                folder.folderName,
                namingInfo.applicableDate
              );

              pdfs.push({
                name: pdfFileName,
                buffer: pdfBuffer,
              });

              logIndent(`✓ ${truncateFileName(pdfFileName, 50)}`, 4);
            } catch (insurerError) {
              logError(
                `Failed to generate PDF for ${insurer.name}様, skipping this person`,
                insurerError
              );
            }
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
    } catch (docError) {
      logError(
        `Failed to process document ${doc.xmlFileName}, skipping`,
        docError
      );
      // 次のドキュメントへ
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
 *   - [雇保]育児休業出生後休業給付
 *   - [雇保]育児時短就業給付
 *   - [雇保]育児休業出生時休業給付
 *
 * 抽出ルール: 手続きタグ `_[雇保]xxx_` の **直前** のフィールドを被保険者名とする。
 * これにより以下の両方の構造に対応：
 *   - 4フィールド: {番号}_{会社名}_{被保険者名}_{手続き種別}
 *   - 5フィールド: {番号}_{会社名}_{被保険者番号}_{被保険者名}_{手続き種別}
 *
 * 例:
 *   "0013_株式会社1SEC_川村 夏菜_[雇保]資格喪失(離職票交付あり)_..."          → "川村夏菜"
 *   "0001_株式会社A_2971676_鈴木 花子_[雇保]育児休業出生後休業給付_..."        → "鈴木花子"
 */
export function extractInsurerNameFromFolderName(folderName: string): string | null {
  // 手続き種別はパス長切り詰めで途中で切れている可能性があるため、頭文字レベル
  // （資格 / 育）のプレフィックスでマッチさせる。
  //   資格 → 資格取得 / 資格喪失
  //   育   → 育児休業出生後休業給付 / 育児時短就業給付 / 育児休業出生時休業給付
  //          ＋ 切り詰められた「育」「育児休業」等
  // 高年齢雇用継続給付・介護休業給付金・教育訓練給付金などの他系統には誤マッチしない。
  //
  // さらに、会社名が極端に長いと `_[雇保]xxx` の `]` も含めて切り詰められ、
  // `..._[雇・・・` のような形になることがある（例: 0009 株式会社Ｙａｃｈｔ...）。
  // この場合は手続き種別が判別できないため、フォルダ末尾が `_[雇・・・` で
  // 終わっているケースに限り、雇保系の対象手続きとみなして救済する。
  // （`_[雇` のみで判断するのは「教育訓練給付金」等の対象外手続きまで巻き込む
  //   可能性があるが、`・・・` で終端＝OS のパス長切り詰めが発生したケースに
  //   限定すれば実害は少ない）
  const isYakuhoTarget = /\[雇保\](?:資格|育)/.test(folderName);
  const isTruncatedYakuho = /_\[雇・・・\/?$/.test(folderName);

  if (!isYakuhoTarget && !isTruncatedYakuho) return null;

  // 「_{被保険者名}_[雇保]手続き種別」または「_{被保険者名}_[雇・・・」の直前フィールドを取得
  // 内部の半角/全角スペースは保持し、前後のみtrim
  // 手続きタグ以降の末尾 `_` は必須としない（パス長切り詰めで末尾が「(離職・・・」のように切れても拾う）
  const match = folderName.match(/_([^_]+)_\[雇/);
  if (match) {
    return match[1].trim();
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
export function extractRoudouHokenKoubunshoInfo(
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
 * [社保]系の公文書フォルダで「{被保険者名}様_{固定通知書名}.pdf」にリネームするマッピング
 *
 * SHAHO_TITLE_MAP は PDF生成時の命名フォールバックに使われるが、
 * このマップは既存PDF（`otherFiles`）のリネーム時に使われる。
 * フォルダにXML/XSLが無く既存PDFが「通知書.pdf」のような名前で同梱されているケースを救済する。
 */
const SHAHO_PER_PERSON_RENAME_MAP: Array<{
  pattern: RegExp;
  title: string;
}> = [
  { pattern: /\[社保\]育児休業等申出書/,    title: '健康保険・厚生年金保険育児休業等取得者確認通知書' },
  { pattern: /\[社保\]産前産後休業等申出書/, title: '健康保険・厚生年金保険産前産後休業取得者確認通知書' },
];

export function getShahoPerPersonRenameTitle(folderName: string): string | null {
  if (!/_公文書_/.test(folderName)) return null;
  for (const { pattern, title } of SHAHO_PER_PERSON_RENAME_MAP) {
    if (pattern.test(folderName)) return title;
  }
  return null;
}

export function extractInsurerNameFromShahoFolder(folderName: string): string | null {
  // 手続きタグ以降の末尾 `_` は必須としない（パス長切り詰めで末尾が切れたケースを救済）
  const match = folderName.match(/_([^_]+)_\[社保\]/);
  return match ? match[1].trim() : null;
}

/**
 * 旧バージョンの本コンバーターが出力した「元号略号始まりの日付付きPDF名」かを判定
 *   例: `R08年01月25日_xxx.pdf` / `H30年04月_xxx.pdf` / `S64年12月25日_xxx.pdf`
 *
 * これらは過去の変換結果が再投入されたケースで、現行版が生成する
 * 「令和8年1月25日_xxx.pdf」と内容が重複するため除外する。
 */
export function isLegacyEraDatePrefixedPdf(fileName: string): boolean {
  if (!fileName.toLowerCase().endsWith('.pdf')) return false;
  return /^[SHR]\d{1,4}年\d{1,2}月(?:\d{1,2}日)?_/.test(fileName);
}

/**
 * 公文書フォルダで固定名にリネームするマッピング（労保・社保など）
 *
 * 対象は「公文書」フォルダのみ（コメントフォルダは対象外）。
 * 必要に応じてエントリを追加してください。
 */
const FIXED_NAME_MAP: Array<{
  pattern: RegExp;
  fileName: string;
}> = [
  { pattern: /\[労保\]保険関係成立届/, fileName: '労働保険関係成立届.pdf' },
  { pattern: /\[労保\]名称所在地変更/, fileName: '労働保険名称所在地変更届.pdf' },
  { pattern: /\[労保\]概算保険料申告\(継続\)/, fileName: '労働保険概算保険料申告書.pdf' },
  { pattern: /\[社保\]新規適用/, fileName: '（社会保険）適用通知書.pdf' },
];

export function getFixedKoubunshoFilename(folderName: string): string | null {
  if (!/_公文書_/.test(folderName)) return null;
  for (const { pattern, fileName } of FIXED_NAME_MAP) {
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
 *   2. 固定名マッピング（労保・社保の各公文書フォルダ・会社単位）:
 *        フォルダ内の **全PDF** をマッピング先の固定ファイル名に統一
 *   3. [社保]育児休業等申出書 / [社保]産前産後休業等申出書（公文書）:
 *        フォルダ内の **全PDF** を `{被保険者名}様_{固定通知書名}.pdf` に統一
 *   4. [雇保]資格取得 / [雇保]資格喪失（離職票交付あり含む）/ 育児系フォルダ:
 *        数字で始まるPDFの数字部分を被保険者名で置換し「{name}様_」を付与
 *   5. それ以外:
 *        そのまま
 */
export function renamePdfIfNeeded(fileName: string, folderName: string): string {
  if (!fileName.toLowerCase().endsWith('.pdf')) return fileName;

  // ルール1: 労働保険年度更新（公文書）— ファイル名形式は問わない
  const roudouHoken = extractRoudouHokenKoubunshoInfo(folderName);
  if (roudouHoken) {
    const suffix = roudouHoken.isKensetsu ? '(建設)' : '';
    return `令和${roudouHoken.reiwaYear}年度_労働保険概算・確定保険料申告書${suffix}.pdf`;
  }

  // ルール2: 公文書の固定名マッピング（労保系/社保新規適用など会社単位の手続き）
  const fixedName = getFixedKoubunshoFilename(folderName);
  if (fixedName) {
    return fixedName;
  }

  // ルール3: 社保 育休/産休（公文書）— ファイル名形式は問わない
  const shahoTitle = getShahoPerPersonRenameTitle(folderName);
  if (shahoTitle) {
    const insurerName = extractInsurerNameFromShahoFolder(folderName);
    if (insurerName) {
      return `${insurerName}様_${shahoTitle}.pdf`;
    }
  }

  // ルール4: 雇用保険 資格取得/喪失/育児系 — 数字始まり（ハイフン付き連番も含む）
  // 例: `2501793096_xxx.pdf` / `202602021152166333-0001_xxx.pdf`
  const numericPrefixMatch = fileName.match(/^\d+(?:-\d+)?_(.+)$/);
  if (numericPrefixMatch) {
    const insurerName = extractInsurerNameFromFolderName(folderName);
    if (insurerName) {
      return `${insurerName}様_${numericPrefixMatch[1]}`;
    }
  }

  return fileName;
}

/**
 * `otherFiles` 内の 1 ファイルを処理した結果を表す
 *   - 社保公文書PDF (7xxxxxx.pdf) → 被保険者ごとに分割した複数 PDF
 *   - それ以外 → 元ファイルをリネームしたもの 1 件
 */
export interface ProcessedOtherFile {
  name: string;
  buffer: Buffer;
  /** 分割によって生成されたものか（ログ用） */
  splitFromOriginal?: string;
}

/**
 * `otherFiles` 内の 1 ファイルを処理して、出力 ZIP に投入すべき
 * `(name, buffer)` の配列を返す。
 *
 * 動作:
 *   1) 社保公文書PDF（`7xxxxxx.pdf` の決まった ID）であれば、ページ単位で
 *      被保険者を読み取って分割＋リネームを試みる。1 件以上抽出できた場合は
 *      その配列を返す。
 *   2) 上記で分割対象外、または被保険者が抽出できなかった場合は、従来通り
 *      `renamePdfIfNeeded` でリネームした 1 件のみを返す。
 *
 * 例外時（読み込みエラーなど）は呼び出し側に投げ返す。
 */
export async function processOtherFile(
  sourcePath: string,
  fileName: string,
  folderName: string
): Promise<ProcessedOtherFile[]> {
  const fileBuffer = await fs.readFile(sourcePath);

  if (isShahoKoubunshoPdfFileName(fileName)) {
    try {
      const splits: SplitPdfResult[] = await splitShahoKoubunshoPdf(
        fileBuffer,
        fileName
      );
      if (splits.length > 0) {
        return splits.map((s) => ({
          name: s.name,
          buffer: s.buffer,
          splitFromOriginal: fileName,
        }));
      }
      // 0 件 = 被保険者氏名がどこからも抽出できなかった
      // → 通常リネーム経路にフォールバック
    } catch (error) {
      console.error(
        `Failed to split shaho koubunsho PDF ${fileName}, falling back to plain rename:`,
        error
      );
    }
  }

  // 通常のリネーム
  const targetFileName = renamePdfIfNeeded(fileName, folderName);
  return [{ name: targetFileName, buffer: fileBuffer }];
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
      // PDFを追加（Windowsエクスプローラ互換のため89文字制限を適用）
      for (const pdf of folder.pdfs) {
        const safeName = fitEntryNameToShellLimit(folderPrefix, pdf.name);
        zip.file(`${folderPrefix}${safeName}`, pdf.buffer);
      }

      // 元のXML/XSLファイルをコピー
      if (folder.xmlXslFiles) {
        for (const fileName of folder.xmlXslFiles) {
          // folderPathを使用（ネストされたZIPの一時ディレクトリにも対応）
          const sourcePath = path.join(folder.folderPath, fileName);

          try {
            const fileBuffer = await fs.readFile(sourcePath);
            const safeName = fitEntryNameToShellLimit(folderPrefix, fileName);
            zip.file(`${folderPrefix}${safeName}`, fileBuffer);
          } catch (error) {
            console.error(`Failed to copy XML/XSL file ${fileName}:`, error);
          }
        }
      }

      // その他のファイルをコピー（PDFはリネーム処理を適用、旧出力の重複は除外）
      if (folder.otherFiles) {
        for (const fileName of folder.otherFiles) {
          // 過去のコンバーター出力（旧元号略号付き日付プレフィックス）はスキップ
          if (isLegacyEraDatePrefixedPdf(fileName)) {
            console.log(`Skipped legacy era-prefix PDF: ${fileName}`);
            continue;
          }

          // folderPathを使用（ネストされたZIPの一時ディレクトリにも対応）
          const sourcePath = path.join(folder.folderPath, fileName);

          try {
            const outputs = await processOtherFile(
              sourcePath,
              fileName,
              folder.folderName
            );
            for (const out of outputs) {
              const safeName = fitEntryNameToShellLimit(folderPrefix, out.name);
              zip.file(`${folderPrefix}${safeName}`, out.buffer);
            }
          } catch (error) {
            console.error(`Failed to copy file ${fileName}:`, error);
          }
        }
      }
    }
    // 旧版では失敗時に `変換エラー.txt` を出力していたが、ユーザー要望により廃止。
    // 変換できたものだけを出力し、失敗内容はサーバーログで確認する。
    // (processFoldersToZip と挙動を揃える)
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
 * Windows エクスプローラ (Shell.Application COM) が認識できる ZIP エントリパスの
 * 最大長。これを超えるエントリは展開ダイアログでエントリ 0 件扱いになり、
 * 「すべて展開」してもファイルが取り出せない。
 *
 * 実測 (Windows 11, JSZip 生成 ZIP):
 *   - 89 文字: 認識される
 *   - 90 文字: 認識されない (entries: 0)
 *
 * 7-Zip / PowerShell Expand-Archive / Unix unzip では問題なく展開できるが、
 * 本サービスの主要ユーザーはエクスプローラを使うため、互換性のために
 * 生成 ZIP のエントリパスを 89 文字以下に収める。
 */
const SHELL_ZIP_ENTRY_MAX_LEN = 89;

/**
 * フォルダプレフィックス + ファイル名 の合計が SHELL_ZIP_ENTRY_MAX_LEN を
 * 超える場合、**通知書名（`様` より後ろの末尾部分）** を切り詰めて短縮する。
 * 省略記号 (`…`) は付けず、収まる文字数までで素直に切る。
 *
 * 方針: **被保険者氏名は身元特定情報なのでフル長で保持**し、通知書名側の末尾
 * （例: `(被保険者用)` や `通知書` の末尾文字）を削る。同じフォルダ内の複数 PDF は
 * 通知書名の **先頭** が異なる（`雇用保険被保険者証...` vs `雇用保険資格喪失届...`
 * 等）ため、末尾を削っても衝突しない。
 *
 * 例:
 *   folderPrefix = "0005_株式会社リプロ　_3813855_滝本 愛奈_[雇保]資格取得・・・/" (59 chars)
 *   fileName     = "滝本 愛奈様_雇用保険被保険者証、資格取得等確認通知書(被保険者用).pdf" (40 chars)
 *   合計 = 99 chars > 89 → 通知書名末尾を切り詰めて:
 *   "滝本 愛奈様_雇用保険被保険者証、資格取得等確認通知.pdf" (30 chars)
 *   （`滝本 愛奈様_` の身元情報部分はそのまま保持）
 *
 * フォールバック:
 *   - 氏名フル + `様_` + 通知書名 1 文字 + `.pdf` でも budget を超える極端ケース:
 *     最低 1 文字の氏名 + `様_` + 通知書名 + `.pdf` まで切り詰める。それでも無理な
 *     ら元のファイル名で返す（=別ツールで展開してもらう）。
 *
 * `様` を含まないファイル（例: 固定名 `表紙.pdf` / `届出控.pdf` 等）は拡張子を
 * 保ったままベース名末尾から素直に切り詰める。フォルダ名側は触らない（入力 ZIP の
 * 構造を尊重するため）。
 */
function fitEntryNameToShellLimit(
  folderPrefix: string,
  fileName: string
): string {
  const totalLen = folderPrefix.length + fileName.length;
  if (totalLen <= SHELL_ZIP_ENTRY_MAX_LEN) return fileName;

  const budget = SHELL_ZIP_ENTRY_MAX_LEN - folderPrefix.length;
  if (budget < 1) return fileName;

  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot) : '';
  const baseWithoutExt = dot >= 0 ? fileName.slice(0, dot) : fileName;
  // 拡張子を含めるとどうしても 1 文字も中身が残らない場合は諦める
  if (ext.length + 1 > budget) return fileName;

  const samaIdx = fileName.indexOf('様');
  if (samaIdx > 0) {
    // `<name>様[他N名]_<title>` 形式を想定。
    // 通知書タイトルとの境界は **`様` より後ろにある最後の `_`** を採用する。
    // （通知書タイトルにはアンダースコアが含まれないため、これが安全な境界）
    const lastUnderscore = baseWithoutExt.lastIndexOf('_');

    if (lastUnderscore > samaIdx) {
      // 氏名+様[+他N名] + `_` (タイトル直前まで) を keepPart として全長保持
      const keepPart = baseWithoutExt.slice(0, lastUnderscore + 1);
      const titlePart = baseWithoutExt.slice(lastUnderscore + 1);

      const fixedLen = keepPart.length + ext.length;
      // 氏名フル + タイトル 1 文字以上を確保できるなら、タイトル末尾だけを削る
      if (fixedLen + 1 <= budget) {
        const titleBudget = budget - fixedLen;
        if (titlePart.length <= titleBudget) return fileName; // 既に収まる
        return keepPart + titlePart.slice(0, titleBudget) + ext;
      }

      // 氏名フルではタイトル 1 文字すら入らない極端ケース:
      // 最低 1 文字の氏名 + `様_他N名_` 等 + タイトル末尾切り詰め + `.pdf`
      const MIN_NAME_CHARS = 1;
      const namePart = baseWithoutExt.slice(0, samaIdx);
      const tagPart = baseWithoutExt.slice(samaIdx, lastUnderscore + 1); // 様[他N名]_
      const fixedAfterMinName = MIN_NAME_CHARS + tagPart.length + ext.length;
      const titleBudget2 = budget - fixedAfterMinName;
      if (titleBudget2 >= 1) {
        return (
          namePart.slice(0, MIN_NAME_CHARS) +
          tagPart +
          titlePart.slice(0, titleBudget2) +
          ext
        );
      }
      // それでも無理なら元のファイル名で返す
      return fileName;
    }

    // `様` の後にアンダースコアが見つからない異常形式
    // → 旧来通り氏名末尾を切り詰める
    const suffixWithExt = fileName.slice(samaIdx);
    const nameBudget = budget - suffixWithExt.length;
    if (nameBudget < 1) return fileName;
    if (nameBudget >= samaIdx) return fileName;
    let trimmedName = baseWithoutExt.slice(0, nameBudget);
    while (trimmedName.length > 1 && /[ 　]$/.test(trimmedName)) {
      trimmedName = trimmedName.slice(0, -1);
    }
    return trimmedName + suffixWithExt;
  }

  // `様` を含まないファイル: 拡張子を残してベース名末尾を切る
  const base = baseWithoutExt;
  const baseBudget = budget - ext.length;
  if (baseBudget < 1) return fileName;
  return base.slice(0, baseBudget) + ext;
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
        const safeName = fitEntryNameToShellLimit(folderPrefix, pdf.name);
        if (safeName !== pdf.name) {
          callbacks?.onLog?.(
            `[${folderNumber}/${total}]   ✂️ Shortened for Windows shell: ${truncateFileName(pdf.name, 40)} → ${truncateFileName(safeName, 50)}`
          );
        }
        zip.file(`${folderPrefix}${safeName}`, createReadStream(tmpPdfPath));
      }
      // ローカル参照を破棄してV8がBufferをGCできるようにする
      generated = null;

      // 元のXML/XSLファイル（ストリームでZIPに流し込む）
      if (folder.xmlXslFiles) {
        for (const fileName of folder.xmlXslFiles) {
          const sourcePath = path.join(folder.folderPath, fileName);
          try {
            await fs.access(sourcePath);
            const safeName = fitEntryNameToShellLimit(folderPrefix, fileName);
            zip.file(`${folderPrefix}${safeName}`, createReadStream(sourcePath));
          } catch (error) {
            console.error(`Failed to copy XML/XSL file ${fileName}:`, error);
          }
        }
      }

      // その他ファイル（PDFはリネーム適用、旧バージョン出力の重複は除外）
      if (folder.otherFiles) {
        for (const fileName of folder.otherFiles) {
          // 過去のコンバーター出力（旧元号略号付き日付プレフィックス）はスキップ
          if (isLegacyEraDatePrefixedPdf(fileName)) {
            callbacks?.onLog?.(
              `[${folderNumber}/${total}]   ⏭️ Skipped legacy era-prefix PDF: ${truncateFileName(fileName, 60)}`
            );
            continue;
          }

          const sourcePath = path.join(folder.folderPath, fileName);
          try {
            const outputs = await processOtherFile(
              sourcePath,
              fileName,
              folder.folderName
            );

            for (const out of outputs) {
              if (out.splitFromOriginal) {
                callbacks?.onLog?.(
                  `[${folderNumber}/${total}]   ✂️ Split + renamed: ${truncateFileName(out.splitFromOriginal, 30)} → ${truncateFileName(out.name, 50)}`
                );
              } else if (out.name !== fileName) {
                callbacks?.onLog?.(
                  `[${folderNumber}/${total}]   ✏️ Renamed: ${truncateFileName(fileName, 40)} → ${truncateFileName(out.name, 50)}`
                );
              }

              const safeName = fitEntryNameToShellLimit(folderPrefix, out.name);
              if (safeName !== out.name) {
                callbacks?.onLog?.(
                  `[${folderNumber}/${total}]   ✂️ Shortened for Windows shell: ${truncateFileName(out.name, 40)} → ${truncateFileName(safeName, 50)}`
                );
              }

              // 分割PDFはバッファ、それ以外（コピー）はファイル参照でストリーム
              if (out.splitFromOriginal) {
                const tmpPdfPath = path.join(
                  intermediatePdfDir,
                  `${pdfCounter++}.pdf`
                );
                await fs.writeFile(tmpPdfPath, out.buffer);
                zip.file(
                  `${folderPrefix}${safeName}`,
                  createReadStream(tmpPdfPath)
                );
              } else {
                // 元ファイルは内容を変えないのでReadStreamで直接流す
                zip.file(
                  `${folderPrefix}${safeName}`,
                  createReadStream(sourcePath)
                );
              }
            }
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
      // ここに到達するのは想定外の障害（fs/JSZip層のエラー等）。
      // PDF変換そのものは processFolderDocuments 内のドキュメント単位 try/catch で
      // 個別に救えるため、ここで `変換エラー.txt` を出力するとフォルダ内のkagamiPDFや
      // 元ファイルコピーが既に成功している場合でも誤って「全失敗」のように見える。
      // ユーザー要望: エラーになった場合でも出力ZIPに「変換エラー.txt」を入れず、
      // 変換できたものと元ファイルだけを残す。
      // 障害内容はサーバーログ + UIログに残してユーザーが事象を確認できるようにする。
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
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

    // streamFiles: false にしている理由:
    //   streamFiles: true を指定すると JSZip は各エントリの Local File
    //   Header にサイズと CRC を書かず、エントリ末尾に Data Descriptor
    //   (General Purpose Bit Flag bit 3) として書き込む形式になる。
    //   この形式は ZIP 仕様としては正当だが、Windows Explorer (Shell.Application
    //   COM) はサポートしておらず、ZIP を開いても「エントリ 0 件」として
    //   見え、すべて展開しようとしても何も展開されない。
    //   PowerShell の Expand-Archive や Unix の unzip、7-Zip などは
    //   問題なく読めるためテストでは気付きにくい。
    //   streamFiles: false にすると CRC/サイズ計算のためエントリ全体を
    //   一旦バッファ化する分メモリ使用量は増えるが、Windows Explorer での
    //   展開互換性が確保できる。本サービスのユーザーはほぼ Windows で
    //   既定のエクスプローラ展開を使うため、互換性を優先する。
    zip
      .generateNodeStream({
        type: 'nodebuffer',
        streamFiles: false,
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
