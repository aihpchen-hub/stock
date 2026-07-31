/**
 * 擋下用 npm / yarn 安裝的嘗試。
 *
 * 為什麼需要：這是 pnpm workspace，package.json 用了 `workspace:` 與
 * `catalog:` 兩個 pnpm 專屬協定，npm 與 yarn 都不認得。
 *
 * 但真正會咬人的不是安裝失敗，而是**失敗前留下的 package-lock.json**：
 * Netlify 是看 lockfile 決定要用哪個套件管理器，撿到 package-lock.json 就會
 * 改用 npm，接著吐出一堆看起來像依賴衝突的錯誤 —— 完全不會提到真正的原因。
 *
 * 用 Node 而不是 shell 腳本：原本的版本寫成 `sh -c '...'`，在 PowerShell 上
 * 因為找不到 sh 而失敗，等於逼所有人都得開 Git Bash。Node 到處都跑得動。
 */
import { rmSync } from 'node:fs';

for (const file of ['package-lock.json', 'yarn.lock']) {
  rmSync(file, { force: true });
}

// 每個套件管理器執行 script 時都會設這個環境變數，值長得像
// "pnpm/11.18.0 npm/? node/v24.15.0 win32 x64"
const userAgent = process.env.npm_config_user_agent ?? '';

if (!userAgent.startsWith('pnpm/')) {
  console.error(
    '\n這是 pnpm workspace —— package.json 使用了 workspace: 與 catalog: 協定，' +
      '\nnpm 與 yarn 都無法解析。\n' +
      '\n請改用：  pnpm install\n' +
      '\n（沒有 pnpm 的話：npm install -g pnpm）\n',
  );
  process.exit(1);
}
