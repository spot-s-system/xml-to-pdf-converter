#!/usr/bin/env node
/**
 * Stop hook — 作業終了時に、渡された全 ZIP fixture を Puppeteer で実変換する統合
 * テスト（npm run test:integration, ~5min）を走らせ、「渡したファイルを全て確認」して
 * から完了する。これにより、ユニットでは拾えないレイアウト/PDF生成/リネームの回帰を
 * 完了前に検出し、場当たり的な修正を防ぐ。
 *
 * 実行条件（コストの高い統合テストを無駄打ちしないためのガード）:
 *   1) stop_hook_active が true（このフック自身のブロックによる再実行）→ skip
 *   2) lib/ ・ __tests__/ に未コミット変更が無い → skip（直す対象が無い）
 *   3) 前回成功時から lib/__tests__ の内容が変わっていない → skip
 *      （.claude/.integration-verified に内容ハッシュを保存して比較）
 *   4) fixture が 1 つも無い → skip（CI/他環境で個人情報 ZIP が無いケース）
 *
 * 出力契約:
 *   - skip or 成功 → exit 0（成功時はハッシュを更新）
 *   - 失敗 → {"decision":"block", ...} を stdout に出力して exit 0
 */
import { execSync } from 'node:child_process';
import {
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

// ガード 1: フック自身のブロックによる再呼び出しでは何もしない（無限ループ防止）
if (input?.stop_hook_active === true) process.exit(0);

const projectDir =
  process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: projectDir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: process.env,
    ...opts,
  });
}

// ガード 2: lib/ ・ __tests__/ に未コミット変更が無ければ skip
let hasChanges = true;
try {
  const status = sh('git status --porcelain -- lib __tests__').trim();
  hasChanges = status.length > 0;
} catch {
  // git が使えない環境では内容ハッシュ比較に委ねる
  hasChanges = true;
}
if (!hasChanges) process.exit(0);

// 全 .ts ソースの内容ハッシュ（path+size+mtime）を計算
function walkTs(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkTs(full, acc);
    else if (e.isFile() && /\.(ts|tsx|mjs)$/.test(e.name)) {
      const st = statSync(full);
      acc.push(`${full}:${st.size}:${st.mtimeMs}`);
    }
  }
  return acc;
}

const sig = walkTs(path.join(projectDir, 'lib'), [])
  .concat(walkTs(path.join(projectDir, '__tests__'), []))
  .sort();
const hash = crypto.createHash('sha1').update(sig.join('\n')).digest('hex');

const markerPath = path.join(projectDir, '.claude', '.integration-verified');
// ガード 3: 前回成功時から内容が変わっていなければ skip
if (existsSync(markerPath)) {
  try {
    if (readFileSync(markerPath, 'utf8').trim() === hash) process.exit(0);
  } catch {
    /* マーカー読めなければ通常実行 */
  }
}

// ガード 4: fixture が 1 つも無ければ統合テストは全 skip になるので走らせない
const fixturesDir = path.join(
  projectDir,
  '__tests__',
  'integration',
  'fixtures'
);
let hasFixture = false;
try {
  hasFixture = readdirSync(fixturesDir).some((f) => f.endsWith('.zip'));
} catch {
  hasFixture = false;
}
if (!hasFixture) process.exit(0);

// 統合テスト実行（渡された全 ZIP を実変換）
try {
  sh('npm run test:integration', { stdio: 'pipe' });
  // 成功 → ハッシュ保存（次回 stop で内容不変なら skip）
  try {
    writeFileSync(markerPath, hash + '\n', 'utf8');
  } catch {
    /* 保存できなくても致命的ではない */
  }
  process.exit(0);
} catch (err) {
  const stdout = err?.stdout?.toString?.() ?? '';
  const stderr = err?.stderr?.toString?.() ?? '';
  const tail = (stdout + '\n' + stderr).trim().slice(-4000);
  const result = {
    decision: 'block',
    reason:
      '統合テスト(npm run test:integration)が失敗しました。渡された ZIP fixture の' +
      'いずれかが正しく変換されていません。完了前に、失敗した fixture を確認して' +
      '場当たり的でない修正を行ってください。（全 fixture を確認するための最終ゲートです）',
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: 'npm run test:integration 失敗の末尾出力:\n' + tail,
    },
  };
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}
