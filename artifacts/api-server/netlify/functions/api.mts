/**
 * Netlify Functions 的進入點 —— 把既有的 Express app 包成單一函式。
 *
 * 為什麼是「一支函式接下所有 /api/*」而不是每個端點一支：
 * 路由、JSON 解析、錯誤處理、每個請求的 logger 都已經長在 Express app 上，
 * 拆成四支就得把那些東西複製四份，或改寫成平台專屬的形式。
 * 包一層的代價只有一個 serverless-http，換來的是本機（`pnpm start`）
 * 與線上跑的是同一份程式碼。app.ts 刻意不含 `listen()`（那在 index.ts）。
 *
 * 為什麼要經過 withLambda 而不是直接 `export const handler = serverless(app)`：
 * 直接匯出 handler 會被判定成舊版（v1）函式並打包成 CJS，而輸出檔的副檔名是
 * .js —— 一旦它落在某個 `"type": "module"` 的 package.json 底下（本專案的
 * artifacts/web 就是），Node 會把它當 ESM 解析，於是 `module is not defined`。
 * withLambda 把 Lambda 形式的 handler 轉成 v2 的 default export，輸出即為 ESM。
 *
 * 為什麼這支檔案住在 artifacts/api-server 而不是 repo 根目錄：
 * Netlify 的打包器不會把 node_modules 內聯進 bundle，而是**追蹤 import 再把
 * 套件一起放進 zip**，追蹤的起點就是這支檔案的位置。放在根目錄時，解析範圍是
 * root 的 package.json —— 那裡沒有 express / pino / cors，於是 zip 裡也沒有，
 * 部署後第一個請求就是 `Cannot find package 'express'`。
 * 放在宣告了這些依賴的套件底下，追蹤才找得到它們。
 */
import { withLambda } from "@netlify/aws-lambda-compat";
import serverless from "serverless-http";

import app from "../../src/app";

/**
 * Netlify 把 /api/* 轉給函式後，事件裡的路徑可能保留 `/.netlify/functions/api`
 * 前綴。Express 內部掛的是 /api，前綴沒剝掉就一律 404 —— 而且是「API 路徑找不到」
 * 這種看起來像路由寫錯的 404，很難聯想到是平台的路徑轉寫。
 *
 * 兩種形式都處理：有前綴就剝掉，沒有就原樣放行。
 */
const FUNCTION_PREFIX = "/.netlify/functions/api";

/** Express 內部把所有路由掛在這底下（見 app.ts 的 `app.use("/api", router)`） */
const API_BASE = "/api";

const lambdaHandler = serverless(app, {
  request(request: { url?: string }) {
    const url = request.url;
    if (typeof url !== "string" || !url.startsWith(FUNCTION_PREFIX)) return;

    // 換成 /api 而不是整段刪掉。刪掉會得到 /healthz，而 Express 要的是
    // /api/healthz —— 那會讓每一支 API 都回 404，且本機直連 Express 時
    // 完全正常，只有部署後才壞。
    request.url = API_BASE + url.slice(FUNCTION_PREFIX.length);
  },
});

/**
 * serverless-http 把回傳型別宣告成 `Object`，比實際情況鬆得多 —— 它執行期
 * 產生的就是 `{ statusCode, headers, body, isBase64Encoded }`，正是 withLambda
 * 要的形狀。這裡的轉型是在補上那份缺失的宣告，不是在掩蓋不相容。
 */
export default withLambda(lambdaHandler as unknown as Parameters<typeof withLambda>[0]);
