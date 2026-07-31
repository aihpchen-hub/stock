# 台股產業分析工具

輸入產業關鍵字或股票代號，AI 拆解台股供應鏈，並為每檔標的算出可執行的波段交易計畫（進場區、停損、停利、建議張數、扣費後淨損益）。

## 快速開始

```bash
npm install -g pnpm        # 若尚未安裝
pnpm install
cp .env.example .env       # 填入金鑰，見下方
```

## 三種本機模式

### 1. 日常開發（有 HMR）

開兩個終端機：

```bash
# 終端機 A —— Express API（:5000）
PORT=5000 NODE_ENV=development pnpm --filter @workspace/api-server run dev

# 終端機 B —— Vite 前端（:5173），/api 自動代理到 :5000
pnpm --filter @workspace/web run dev
```

開 <http://localhost:5173>。

### 2. 同源驗證（最接近正式環境的行為）

```bash
pnpm run build
PORT=5000 pnpm start
```

開 <http://localhost:5000> —— 單一 process 同時吐網頁與 API，兩者同源，
連 SPA 深層路徑（`/analysis?keyword=…`）都與線上一致。改完 UI 想確認
「build 出來的東西真的對」時用這個。

### 3. 完全等同 Netlify

```bash
netlify dev
```

**需要先開啟 Windows 開發者模式**（設定 → 系統 → 開發者專用）。
`netlify dev` 要建立 symlink 才能把函式依賴放到位，而 Windows 預設不允許
非管理員建立 symlink，否則會 `EPERM: operation not permitted, symlink`。

平常不需要用它 —— 函式包裝層已由 `artifacts/api-server/netlify/functions/api.test.ts`
涵蓋，`pnpm test` 就會抓到那層的錯誤。

> **模式 1 與 2 跑的是 Express 本身，沒有經過 Netlify 的函式包裝。**
> 那層包裝（`serverless-http` + `withLambda` + 路徑前綴處理）只有模式 3
> 與正式環境會執行到，所以它有自己的測試 —— 少了那個測試，包裝層的錯誤
> 會變成「本機全對、部署後每支 API 都 404」。

**其他指令：**

| 指令 | 用途 |
|---|---|
| `pnpm test` | 測試（約 3 秒，不呼叫任何外部 API） |
| `pnpm run typecheck` | 全 workspace 型別檢查，含 Netlify 函式 |
| `pnpm run build` | 建置前後端 |
| `pnpm --filter @workspace/api-spec run codegen` | 由 OpenAPI 規格重新產生 hooks 與 Zod schema |

### 環境變數

| 變數 | 用途 | 缺少時 |
|---|---|---|
| `PORT` | 本機 API 埠號 | 預設 5000 |
| `GEMINI_API_KEY` | 產業分析 | `/api/analyze` 回明確錯誤 |
| `GEMINI_API_KEY_2` / `_3` | 額度用盡時的備援金鑰 | 只是少一層備援 |
| `TAVILY_API_KEY` | 新聞搜尋 | 降級為「無相關報導」，仍可分析 |
| `FINMIND_TOKEN` | 股價、營收、法人、基本資料 | 仍可查，但速率限制較嚴 |
| `ALLOWED_ORIGINS` | 逗號分隔的允許來源 | **不設就完全關閉 CORS**（同源部署的正確預設） |

**沒有資料庫。** 查詢紀錄存在瀏覽器 localStorage，分析結果與個股資料快取在 Netlify Blobs（以日為單位）。

## 部署到 Netlify

1. 把 repo 推到 GitHub
2. Netlify 建立新站台，連上該 repo
3. **Base directory 留空**（repo 根目錄）—— 根目錄的 `netlify.toml` 會被採用
4. 在 Site settings → Environment variables 填入上表的金鑰
5. 之後 push 到 production 分支即自動建置部署

`netlify.toml` 已設定好 build 指令、發佈目錄、函式目錄與 `/api/*` 的 rewrite，不需要在 UI 額外設定。

本機驗證部署設定：

```bash
CI=true netlify build --offline --filter @workspace/web
```

（`--filter` 是 CLI 對 monorepo 的要求；建置本身仍走根目錄的 `netlify.toml`。）

## 架構

```
        瀏覽器
          │  相對路徑 /api/...（同源）
          ▼
   Netlify CDN ──► 靜態前端（artifacts/web/dist/public）
          │
          └─ /api/* rewrite ──► Netlify Function
                                 └─ Express app（artifacts/api-server）
                                      ├─ Gemini（分析）
                                      ├─ Tavily（新聞）
                                      └─ FinMind（股價／財報／法人）
```

- **前端**：Vite 7 + React 19 + Tailwind 4 + shadcn/ui + wouter + TanStack Query
- **後端**：Express 5，包成單一 Netlify Function
- **契約**：`lib/api-spec/openapi.yaml` 是唯一真實來源，Orval 產生前端 hooks 與 zod schema

### 檔案位置

| 內容 | 位置 |
|---|---|
| API 契約（唯一真實來源） | `lib/api-spec/openapi.yaml` |
| 指標計算（ATR、均線、擺盪、均量） | `artifacts/api-server/src/lib/indicators.ts` |
| 評分、三情境期望值、交易計畫 | `artifacts/api-server/src/lib/tradePlan.ts` |
| 台股檔位（最小升降單位） | `artifacts/api-server/src/lib/ticks.ts` |
| 前瞻驗證（事後對答案） | `artifacts/api-server/src/lib/outcome.ts` |
| 快取（儲存層／以日失效） | `artifacts/api-server/src/lib/cacheStore.ts`、`dailyCache.ts` |
| 每日配額 | `artifacts/api-server/src/lib/rateLimit.ts` |
| Netlify 函式進入點 | `artifacts/api-server/netlify/functions/api.mts` |
| 手續費與證交稅 | `artifacts/web/src/lib/fees.ts` |
| 部位計算（雙重上限） | `artifacts/web/src/lib/settings.ts` |
| 查詢紀錄快照 | `artifacts/web/src/lib/history.ts` |

## 設計決策

- **權威資料優先於模型輸出。** 公司名稱與產業別一律以證交所／櫃買（經 FinMind）為準，模型的描述並列顯示並標明來源。少了這一步，搜尋「8111」會撈到美國佛州法案，模型便把立碁判成生技股。
- **價位一律取整到合法檔位。** 未取整會產生無法下單的價格（1000 元以上個股的檔位是 5 元）。
- **判斷層與計算層分開陳述。** 幅度由該檔自身 ATR 推得、可驗算；三情境機率與評分權重是經驗設定、**未經回測**，畫面上明確標示。
- **快取分成「儲存位置」與「以日失效」兩層。** 正式環境是 serverless，模組層級的 Map 會因冷啟動與多實例而完全失效；抽開之後同一套失效邏輯可同時支撐 Netlify Blobs 與本機記憶體，且只需要測一次。
- **每日配額不是安全邊界。** Blobs 沒有原子遞增，並行請求可能少算。它擋的是隨手寫的迴圈腳本燒光 Gemini 額度，不是有心人。

## 踩過的坑

這些都是實際發生過、且錯誤訊息不會指向真正原因的問題：

- **Netlify 函式不會把 node_modules 內聯進 bundle**，而是從函式檔位置往上追蹤 import 再放進 zip。函式因此必須放在 `artifacts/api-server/` 底下 —— 放根目錄時解析範圍是 root 的 package.json，express／pino／cors 都不在那裡，`netlify build` 完全成功但 zip 缺套件，部署後第一個請求才 `Cannot find package 'express'`。
- **SPA 收尾規則要放 `artifacts/web/public/_redirects`，不能放 `netlify.toml`。** 放 netlify.toml 時 `netlify dev` 會在代理給 Vite 之前就套用，把 `/src/main.tsx` 也改寫成 `/index.html`，前端整個載不起來 —— 畫面全白，而主控台錯誤看起來像 HTML 壞掉。
- **函式打包成 CJS 時 `import.meta.url` 是 undefined。** 在模組載入時就呼叫 `fileURLToPath(import.meta.url)` 會讓函式冷啟動即崩潰，錯誤訊息只說「path 參數必須是字串」。
- **函式必須經 `withLambda` 轉成 v2 default export。** 直接 `export const handler = serverless(app)` 會被判定成 v1 並打包成 CJS，輸出副檔名是 `.js`，一旦落在 `"type": "module"` 的目錄下就是 `module is not defined`。
- **`/.netlify/functions/api` 前綴要「換成 `/api`」而不是整段刪掉。** 刪掉會得到 `/healthz`，而 Express 的路由掛在 `/api` 底下 —— 結果是部署後每一支 API 都 404，本機直連 Express 卻完全正常。
- **pino-pretty 的判斷條件是「等於 development」而非「不等於 production」。** 它走 worker thread，在 serverless 上會爆；而函式環境的 `NODE_ENV` 不保證是 `production`。
- **`pnpm-workspace.yaml` 的 overrides 排除了非 Linux/Windows 平台的二進位檔**以縮小安裝體積。要在 macOS 開發需刪掉對應的 darwin 項目。
- **`/api/analyze` 要 16~20 秒**（Tavily + Gemini）。Netlify 同步函式上限 60 秒，放得下；但 10 秒上限的平台放不了。
- **Gemini 走「模型 × 金鑰」全組合輪替**，不是單純換金鑰 —— 較新的金鑰對某些模型會回 404，換金鑰無法解決模型不可用的問題。
- **`vitest.config.ts` 必須用 `fileURLToPath`。** 專案路徑含非 ASCII 字元，直接取 `URL.pathname` 會拿到 percent-encoded 的無效路徑。
- 日線資料延遲一天，畫面上以「收盤 MM/DD」標示。**不適合當日操作。**
