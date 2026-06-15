#!/usr/bin/env node
/**
 * PostToolUse hook — UI の操作フローに関わるファイル
 * (app/page.tsx / components/file-dropzone.tsx) を編集したら、「使い方」表記が
 * 実装と食い違わないように同期更新を促す。
 *
 * 方針: 決定的なフックでは正しい日本語の手順文を生成できないため、ここでは
 * **ブロックせず** additionalContext で Claude に「使い方の同期更新」を指示する
 * （update-usage-guide スキルの実行を促す）。実際の文言更新は Claude が行う。
 *
 * 対象でないファイルの編集では何も出力せず exit 0。
 */
import { execSync } from 'node:child_process';

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (raw += d));
    process.stdin.on('end', () => resolve(raw));
    setTimeout(() => resolve(raw), 2000);
  });
}

const raw = await readStdin();
let input = {};
try {
  input = JSON.parse(raw || '{}');
} catch {
  input = {};
}

const filePath = String(input?.tool_input?.file_path ?? '').replace(/\\/g, '/');

// 操作フローに関わる UI ファイルのみ対象
const isUiFlowFile =
  /(^|\/)app\/page\.tsx$/.test(filePath) ||
  /(^|\/)components\/file-dropzone\.tsx$/.test(filePath);

if (!isUiFlowFile) process.exit(0);

// 「使い方」表記が実装と乖離しうるので、同期更新を促す。
// 既に一致しているなら Claude 側の判断で no-op になる（過剰更新はしない）。
const projectDir =
  process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();

// 参考情報: 現状コードに自動変換 useEffect があるか／README 使い方が古いかを軽く検出して
// additionalContext に含める（Claude の判断材料）。git 等の重い処理はしない。
let hints = '';
try {
  const grep = (pattern, file) => {
    try {
      execSync(
        `node -e "const s=require('fs').readFileSync(${JSON.stringify(
          `${projectDir}/${file}`
        )},'utf8');process.exit(new RegExp(${JSON.stringify(
          pattern
        )}).test(s)?0:1)"`,
        { stdio: 'ignore' }
      );
      return true;
    } catch {
      return false;
    }
  };
  const autoConvert = grep('if \\(zipFile && !isConverting\\)', 'app/page.tsx');
  const readmeOldButton = grep('一括変換」ボタンをクリック', 'README.md');
  hints =
    `\n- app/page.tsx の自動変換 useEffect: ${autoConvert ? 'あり' : 'なし'}` +
    `\n- README.md に旧表記「一括変換」ボタンをクリック: ${
      readmeOldButton ? '残っている（要更新の可能性）' : '無し'
    }`;
} catch {
  hints = '';
}

const result = {
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext:
      `操作フローに関わる UI ファイル（${filePath
        .split('/')
        .pop()}）が編集されました。` +
      'アプリの「使い方」表記が実装と食い違わないよう、update-usage-guide スキルの手順で ' +
      'app/page.tsx の使い方リスト・アップロードカード説明文、README.md の ## 使い方 節を ' +
      '現状コードに合わせて同期更新してください（操作フローが変わっていなければ no-op で可）。' +
      hints,
  },
};
process.stdout.write(JSON.stringify(result));
process.exit(0);
