import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 必須用 fileURLToPath：專案路徑含非 ASCII 字元（測試），
// 直接取 URL.pathname 會拿到 percent-encoded 的無效路徑。
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'artifacts/api-server/src/**/*.test.ts',
      // Netlify 函式的包裝層。本機開發直接跑 Express，這層不會被執行過 ——
      // 沒有測試的話它的錯誤只會在部署後才浮現。
      // 測試檔刻意放在 netlify/ 而不是 netlify/functions/：後者底下的每個檔案
      // 都會被 Netlify 當成一支函式部署，而 `api.test` 含點號是不合法的函式名。
      'artifacts/api-server/netlify/*.test.ts',
      'artifacts/web/src/**/*.test.ts',
      // lib/ 底下的共用套件。`@workspace/advice` 同時被後端與前端引用，
      // 沒有這一條，它的測試會在移進 lib/ 之後靜靜地不再執行。
      'lib/*/src/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      // 與 artifacts/web/vite.config.ts 的 '@' 一致，測試才不會因為
      // 解析規則不同而在正式建置能過、測試卻找不到模組。
      '@': path.resolve(root, 'artifacts/web/src'),
    },
  },
});
