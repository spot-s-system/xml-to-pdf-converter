#!/usr/bin/env node
/**
 * PostToolUse hook — lib/ または __tests__/ のソースを編集したら即座にユニット
 * テスト（npm test, ~1s, fixture 不要）を走らせ、命名ロジックの全ケースで回帰が
 * 起きていないかを確認する。
 *
 * 目的: 1 ケースだけ直して別ケースを壊す「場当たり的な修正」を、編集直後に検出して
 * ブロックする。失敗時はテスト出力を additionalContext で Claude に返し、修正を促す。
 *
 * stdin: Claude Code が渡す PostToolUse ペイロード（JSON）。
 *   - tool_input.file_path: 編集されたファイルの絶対パス
 *   - cwd: セッションの作業ディレクトリ（プロジェクトルート）
 *
 * 出力契約:
 *   - 対象外ファイル or テスト成功 → 何も出力せず exit 0
 *   - テスト失敗 → {"decision":"block", ...} を stdout に出力して exit 0
 */
import { execSync } from 'node:child_process';

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (raw += d));
    process.stdin.on('end', () => resolve(raw));
    // stdin が来ないケースのフォールバック
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

const filePath = input?.tool_input?.file_path ?? '';
const norm = String(filePath).replace(/\\/g, '/');

// lib/ または __tests__/ 配下の編集のみ対象（その他のファイル編集ではテストしない）
if (!/(^|\/)(lib|__tests__)\//.test(norm)) {
  process.exit(0);
}

const projectDir =
  process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();

try {
  execSync('npm test', {
    cwd: projectDir,
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env,
  });
  // 成功: 何も出力せず終了
  process.exit(0);
} catch (err) {
  const stdout = err?.stdout?.toString?.() ?? '';
  const stderr = err?.stderr?.toString?.() ?? '';
  const tail = (stdout + '\n' + stderr).trim().slice(-4000);
  const result = {
    decision: 'block',
    reason:
      'ユニットテスト(npm test)が失敗しました。直近の編集が、これまでに渡された全ケース' +
      '（命名・トリミング・各手続き種別）のどれかを壊している可能性があります。' +
      '場当たり的な修正になっていないか、失敗ケースを確認して修正してください。',
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: 'npm test 失敗の末尾出力:\n' + tail,
    },
  };
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}
