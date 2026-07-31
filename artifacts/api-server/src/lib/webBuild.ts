/**
 * 找出前端網頁建置的位置，讓同一個 process 同時吐網頁與 API。
 *
 * 正式環境（Netlify）用不到這一段 —— 靜態檔由 CDN 送，函式只收 /api/*。
 * 它存在是為了本機：`pnpm --filter @workspace/api-server run start` 就能在
 * 單一 port 上得到一份與線上同構的「同源 /api」環境，不必另外開前端。
 *
 * 前端呼叫的是**相對路徑** /api/...（baseUrl 在 codegen 時就寫死，見
 * lib/api-spec/orval.config.ts），所以網頁與 API 必須同源。
 *
 * 找不到建置時回 null，呼叫端就只掛 API —— 開發時前端跑在 Vite 上，
 * 不該因為沒有 production 建置而讓伺服器起不來。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 本模組所在目錄；取不到時回 null。
 *
 * 兩個都會真實發生的狀況：
 *
 * 1. 專案路徑含非 ASCII 字元時，直接取 `URL.pathname` 會拿到 percent-encoded
 *    的無效路徑 —— 所以必須經過 fileURLToPath。
 * 2. Netlify 的函式打包器輸出 CJS，此時 esbuild 會把 `import.meta` 換成空物件，
 *    `import.meta.url` 因而是 undefined。若在模組載入時就直接呼叫
 *    fileURLToPath，整個函式會在冷啟動當下拋錯 —— 而錯誤訊息只會說
 *    「path 參數必須是字串」，完全看不出跟打包格式有關。
 *
 * 因此延後到呼叫時才解析，並且容許失敗：拿不到目錄就只走環境變數指定的路徑，
 * 而 serverless 上本來就不需要這段（靜態檔由 CDN 送）。
 */
function moduleDir(): string | null {
  const url = import.meta.url;
  if (typeof url !== "string" || url === "") return null;
  try {
    return path.dirname(fileURLToPath(url));
  } catch {
    return null;
  }
}

/**
 * 預設位置。打包後 import.meta.url 指向 artifacts/api-server/dist/，
 * 因此往上兩層才是 artifacts/。
 */
const DEFAULT_RELATIVE = ["..", "..", "web", "dist", "public"];

export interface WebBuild {
  dir: string;
  indexHtml: string;
}

/**
 * 依序檢查環境變數指定的路徑與預設路徑。
 * 必須同時有目錄與 index.html 才算有效 —— 只有空目錄時掛上去會回一堆 404。
 */
export function findWebBuild(explicitDir = process.env["WEB_BUILD_DIR"]): WebBuild | null {
  const here = moduleDir();
  const candidates = [
    ...(explicitDir ? [path.resolve(explicitDir)] : []),
    ...(here ? [path.resolve(here, ...DEFAULT_RELATIVE)] : []),
  ];

  for (const dir of candidates) {
    const indexHtml = path.join(dir, "index.html");
    if (fs.existsSync(indexHtml) && fs.statSync(indexHtml).isFile()) {
      return { dir, indexHtml };
    }
  }
  return null;
}
