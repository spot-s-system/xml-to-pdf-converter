import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    // 統合テストはサーバー側ヘルパー（fs / Puppeteer 経由のPDF生成）を呼ぶため
    // Node 環境必須。重い処理を含むのでタイムアウトもデフォルトより緩く。
    environment: 'node',
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
