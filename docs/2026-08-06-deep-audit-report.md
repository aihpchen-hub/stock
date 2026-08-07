# 股票 Side Project 深度測試與診斷報告

**受測版本**：`060ed76`（main）　**測試日期**：2026-08-06
**測試方法**：10 個維度平行深度掃描 → 逐項對抗式驗證（驗證員預設立場為駁回，須親自回讀行號才判成立）
**結果**：68 項提出 → **66 項確認成立、2 項遭駁回**；去除重複後 **58 項獨立發現，8 項 High**

---

## 執行狀態（2026-08-06 同日修畢）

P0（6 項）、P1（9 項）、P2（打磨）**全部完成**，分五個提交落在 `main`（未 push）。
「產品方向」一節（R-16 K 線圖、R-17 payload 分層、R-18 批次端點）**未做** —— 那是新功能與架構改造，非缺陷。

| 提交 | 內容 |
|---|---|
| `d178d2e` | R-1 部位改用淨風險、R-5 新股防線、R-4a `ev` 可為 null、`limitedBy` 歸因 |
| `7c611bc` | R-4b FinMind 失敗可辨識＋`degraded`、R-2 驗證 Gemini 輸出、R-2b ErrorBoundary 與遮罩死結、R-3 失敗卡片、R-12 toast、R-9 免責 |
| `b05c401` | R-6 除權息不再汙染 ATR 與前瞻驗證，`RULE_VERSION` 3→4 |
| `ab9f5ff` | R-7 紅漲綠跌、R-8 對比度、R-10 視圖開關、R-11 統計誠實度、R-13~R-15 |
| `d3a1ff6` | P2：`lib/format.ts` 統一數字格式、快取切日改台北時區、死碼、`lang`/`color-scheme` |

**驗證**：`pnpm test` **567 → 646 通過**（38 檔）、`pnpm run typecheck` 全 workspace 乾淨、`pnpm run build` 成功、建置產物實跑 smoke test（healthz 200／SPA 深層路徑 200／壞輸入 400 帶原因）。
測試在 `TZ=UTC`、`TZ=Asia/Taipei`、`TZ=America/Los_Angeles` 下都通過 —— 時區缺陷的測試在 UTC 下會紅，那正是它的重點。

**做法**：所有運算層修正都走 TDD（先寫失敗測試、確認它因為真正的缺陷而失敗、再修）。
純 JSX／樣式的改動（footer、色票、`aria-label`）無法單元測試，靠 typecheck + build + smoke test 驗證。
為了讓 UI 層的判斷可測，把埋在 685 行元件裡的接線抽成 `lib/position.ts`、`lib/apiError.ts`、
`lib/verifyStats.ts`、`lib/format.ts` 四個純函式模組 —— 這也順帶消除了「同一個決定被複製四次」這個根因。

**未執行**：README 提到的函式打包驗證
（`CI=true netlify build --offline` + `unzip -p … | grep -c "as default"`）需要 Windows 開發者模式建立 symlink。
本次沒有更動函式的相依圖（沒有新增 workspace 套件到函式的 import 鏈），風險低，
但**部署前建議照 README 跑一次**。

---

## 0. 先講結論

這個 codebase 的水準明顯高於一般 side project。**567 個測試全綠、33 個測試檔、4.76 秒**，`openapi.yaml` 是真正被遵守的單一真實來源，程式碼裡大量中文註解說明「為什麼這樣做」而非「做了什麼」，而且多數註解記錄的是真實踩過的坑。以下三件事已經做到多數同類產品沒做到的程度：

- **價位一律取整到合法檔位**，不會產生無法下單的價格
- **扣費後的風報比才是主指標**，毛值收進摺疊層——這是絕大多數工具不做的事
- **`planKind === 'none'` 時整組價位不顯示**，避免「已跌破停損」與「強烈買進」並存

所以下面找到的問題，幾乎沒有一項是「忘了寫」。它們集中在三個測試抓不到的縫隙：

1. **外部資料失敗的路徑**——FinMind 限流、Gemini 漏欄位。程式碼把「抓不到」和「值是零」混成同一個表示，然後把降級後的結果當成正確答案快取一整天。
2. **兩把尺沒有對齊**——同一個概念在不同檔案用不同定義計算（毛值 vs 淨值、entryMid vs entryHigh、期望值排名 vs 20 日報酬排名），各自都對，並排就矛盾。
3. **台灣市場的在地慣例**——紅漲綠跌、免責聲明、還原股價。這三項與程式品質無關，但決定產品能不能給台灣人用。

---

## 1. 測試項目總覽表（Executive Summary）

| # | 測試維度 | 檢查重點 | 發現 | High | 風險等級 |
|---|---|---|---|---|---|
| 1 | **JSON 契約與邊界值** | required 清單、nullable/optional、模型輸出驗證、快照相容 | 6 | 2 | 🔴 高 |
| 2 | **數字格式化與精度** | 千分位、小數位、單位（股/張）、NaN/null 渲染 | 8 | 1 | 🟡 中 |
| 3 | **金融計算正確性** | 漲跌停、停牌、新股、除權息、部位計算、手續費 | 7 | 3 | 🔴 高 |
| 4 | **色彩慣例與對比** | 紅漲綠跌、WCAG AA、僅靠顏色傳達、資訊層級 | 6 | 0 | 🟡 中 |
| 5 | **載入／錯誤／異常狀態** | alert()、ErrorBoundary、部分失敗、timeout、配額 | 6 | 2 | 🔴 高 |
| 6 | **響應式與無障礙** | 375px 版面、觸控目標、鍵盤、螢幕閱讀器、字級 | 7 | 0 | 🟡 中 |
| 7 | **Payload 與請求負擔** | 扇出、快取、localStorage、即時性改造成本 | 7 | 1 | 🟡 中 |
| 8 | **角色：小白新手** | 術語、認知負擔、誤操作、免責 | 7 | 1 | 🔴 高 |
| 9 | **角色：活躍交易員** | 資訊密度、圖表、參數、統計效力、匯出 | 7（駁回 2） | 0 | 🟡 中 |
| 10 | **角色：開發者** | React 正確性、型別破口、安全、可維護性 | 7 | 0 | 🟡 中 |

### 各層通過情形

| 層級 | 判定 | 說明 |
|---|---|---|
| **JSON 資料層** | ⚠️ 有條件通過 | 契約設計優秀（994 行規格，欄位語意寫得比多數商業 API 清楚），但**執行期完全不驗證**：Orval 產的 zod schema 從未被前端使用，Gemini 輸出無 schema 約束。 |
| **UI 視覺層** | ⚠️ 有條件通過 | 資訊層級經過刻意設計（結論在前、佐證在後、重複價位已刪）。**但色彩語意整站與台股慣例相反**，且小字對比全站低於 WCAG AA。 |
| **UX 操作層** | ❌ 需修正 | 主流程順暢，但**異常路徑幾乎沒有出口**：三處原生 `alert()`、零 ErrorBoundary、失敗的卡片永遠停在骨架、遮罩可能永不消失。 |
| **測試覆蓋** | ⚠️ 形狀失衡 | 567 個測試全部集中在純函式；**React 元件測試 0 個、整合測試 0 個、E2E 0 個**。本報告 8 項 High 沒有一項會被現有測試抓到。 |

---

## 2. 多角色視角測試與遇到問題

### 2.1 【小白新手投資人】

> 35 歲上班族，去年開戶只買過 0050，看不懂 K 線。聽同事說 AI 概念股很熱。

**測試情境／操作流程**

1. 開首頁 → 看到搜尋框、八個關鍵字 chip、「部位與資金設定」四個欄位
2. 直接點「AI水冷散熱」chip → 送出（**沒有動過任何設定**）
3. 等 16~20 秒全螢幕遮罩 → 進入分析頁（預設 `newbie` 視圖）
4. 讀產業總結 → 催化劑 → 期望值排名表 → 五張個股卡片

| # | 痛點 | 嚴重度 |
|---|---|---|
| B-1 | **建議張數建立在他從未同意的假設上**。`DEFAULT_CAPITAL = 1,000,000`、`DEFAULT_RISK_BUDGET = 20,000`、`DEFAULT_MAX_POSITION_PCT = 0.3`。帳戶只有 10 萬的人會看到「建議張數 3 張／投入金額 NT$ 285,000」，而**分析頁上沒有一個字提到 100 萬**，也沒有任何路徑可以在原地改。從查詢紀錄點回舊快照更糟——連首頁那四個預填欄位都沒經過。 | **High** |
| B-2 | **全站沒有任何免責聲明**。grep `僅供參考｜不構成｜投資建議｜免責` 全 repo 零命中。畫面卻直接輸出綠色「強烈買進」藥丸 + 具體進場區 + 停損 + 停利 + 建議張數 + 投入金額。這在台灣是《證券投資信託及顧問法》第 4 條「證券投資顧問」定義的爭議區。README 開頭「**可執行**的波段交易計畫」還加深了這一點。 | **Medium**（法遵風險則為 High） |
| B-3 | **新手視圖砍掉 E(V)，卻沒關掉建立在 E(V) 上的兩個結論**。`newbie` 的 `show` 清單沒有 `expected_value`，但卡片右上角的「強烈買進」徽章（`stock-card.tsx:232`）與整張「期望值排名」表（`analysis.tsx:323`）都不受 profile 控制。結果與設計意圖完全相反：那張**未經回測**的機率表不但沒對新手隱藏，還以最不可辯駁的形式（一個祈使句動詞）出現在視覺權重最高的角落，而支撐它的數字被藏起來——新手連質疑的材料都沒有。 | **High** |
| B-4 | **摘要句與同卡片的數字正面打架**。`narrative.ts:99` 印**未扣費**的毛風報比，白話成句、排在最上面、最好讀：「…停損 100（風報比 1.20），適合波段操作」。往下幾行才是「風報比（扣費後）: 0.96」+ 紅框警示。作者花了整段註解消除的並排矛盾，被後端模板句原封不動印回來，而且毛值那份排在前面。 | **Medium** |
| B-5 | **預設視圖仍有十餘個沒解釋的術語**：達標率／計畫成立率／已結案／規則 v3／相對強弱／第 2/5 強／均量 1.85×／風報比（扣費後）／20日高／進場上緣。專案裝了 `tooltip.tsx` 與 `hover-card.tsx`，**一次都沒用**。最關鍵的是「風報比」——決定一筆交易值不值得做的核心概念，畫面上唯一解釋它的地方是它**跌破 1 時才出現**的紅框；有利時反而沒有任何說明。 | **Medium** |
| B-6 | **「清除全部」無二次確認，且清不掉達標率**。滑過那個紅色小字 50 筆快照就沒了，無確認、無 undo、無匯出——而這批快照是前瞻驗證唯一的輸入。清完後首頁整塊消失，但**每張個股卡片仍印著「這套規則（v3）目前實測：達標率 62.5%（已結案 8 筆）」**，那 8 筆已經不存在、無法重驗、UI 上沒有任何路徑可以清掉。專案裝了 `alert-dialog.tsx` 卻沒用。 | **Medium** |
| B-7 | **新手視圖翻譯了「近月均價」，同張卡片仍寫「月線」「雙均線」**。`view-profile` 的 `PLAIN_MA` 只作用在「均線位置」那一格，`price-map.tsx`、`advice-banner.tsx`、`market-panel.tsx` 仍用技術用語。 | **Medium** |

---

### 2.2 【技術面／量化活躍交易者】

> 全職交易者，慣用 XQ／CMoney，一天進出數次，會自己寫 Python 回測。

**測試情境／操作流程**

1. 輸入「2330」→ 期待看到即時報價與 K 線
2. 檢視資訊密度與可比較性 → 檢查參數可調性 → 找匯出／API → 檢驗前瞻驗證的統計效力

| # | 痛點 | 嚴重度 |
|---|---|---|
| T-1 | **前瞻驗證沒有最小樣本門檻**。`decided=1、targetRate=100.0` 時，首頁最大的字是綠色的「100.0%」，而且這個數字會跟著出現在他當天查的**每一張個股卡片**上，語氣是「這套規則目前實測」。這是全站唯一宣稱「已驗證」的數字，卻是最沒有統計效力的那個。會回測的人看到 n=1 的 100% 被當成 validation evidence，對整份工具的信任直接歸零。 | **Medium** |
| T-2 | **驗證請求超過 40 筆被靜默截斷，而且截掉的是最舊的**。`MAX_ENTRIES = 50` 筆快照 × 每筆約 5 檔 = 累積三個月會有 200 筆計畫。畫面上五格加總永遠是 40，而保留的是**最新**（最沒走完）的那批 → `open` 與 `no_entry` 被系統性放大、`decided` 被系統性壓縮。**累積越久的使用者，看到的 decided 反而不會增加**，達標率永遠停在小樣本高變異區。畫面上沒有一個字提過 40。 | **Medium** |
| T-3 | **同一份計畫重複計數**。重複查同一關鍵字會讓驗證樣本線性膨脹——同一檔在不同日期的快照被當成獨立樣本送去對答案，但它們共用大量重疊的價格區間。 | **Medium** |
| T-4 | **期望值排名表不可排序、不可加欄、現價無資料日期**。唯一的橫向比較介面只有 5 個固定欄位，且手機端 `hidden md:block` 整個藏掉。 | **Medium** |
| T-5 | **整套邏輯只支援作多**。`advice` 的四個狀態全是多方語意，`tradePlan` 的停損永遠在下、停利永遠在上。**最看空的狀態（`below_both` + 評分 -7）仍輸出一份做多計畫**（改成 `conditional`「站回月線後」），而台股可以融券放空。 | **Low** |
| T-6 | 資料延遲一天，不支援當沖／隔日沖。**已妥善處理**——`momentum` 視圖的 `caveat` 明講、`DataFreshness` 元件逐來源標日期。 | ✅ 通過 |
| T-7 | 無自選股、無到價警示、無 CSV/JSON 匯出。查詢紀錄是「查過什麼」不是「我在追什麼」。 | **Low** |

**兩項遭駁回**（記錄於此以示測試的可信度）：

- ❌ *「零圖表且 API 不回價格序列，圖表在資料層就不可能」* —— 駁回。`price-map.tsx`（148 行、`h-[300px]`）已經用 `swingLow/swingHigh/ma20/ma60/entryLow/entryHigh/stopLoss/takeProfit` 在真實比例軸上畫出價位地圖，提出者自己舉的例子內部就矛盾。缺的是 K 線（需要 OHLC 序列），不是「圖表不可能」。
- ❌ *「所有指標參數硬編碼」* —— 引用的行號全對（ATR 14、MA 20/60、MACD 12/26/9、KD 9/3/3、停損 2×ATR），但這是**刻意的設計決策**而非缺陷：README 明載「三情境機率與評分權重是經驗設定、未經回測」，開放調參會讓那個未經驗證的基礎被放大成無限組合。

---

### 2.3 【前端／全棧開發者】

> 接手這個 codebase 的資深工程師。

**測試情境／操作流程**

`pnpm install` → `pnpm test`（567 綠）→ 讀 `openapi.yaml` → 追前後端資料流 → 檢視錯誤處理與型別破口

| # | 痛點 | 嚴重度 |
|---|---|---|
| D-1 | **全樹零 ErrorBoundary**——而程式碼裡有**三處註解自己承認這件事**（`chips-panel.tsx:96`、`verifyStore.ts:10` 等），每處各自做了防禦性查表，卻沒人補那一個 boundary。任一元件 render 期間丟例外 = 整棵樹卸載 = 全白畫面，連「返回首頁」都沒有。 | **High**（見 J-1） |
| D-2 | **`retry: false` 全域關閉重試**（`App.tsx:11`），而後端依賴的 FinMind 免費層限流是常態。 | **Medium** |
| D-3 | **`period` 未驗證**。`analysis.tsx:39` 是裸 `as AnalyzeRequestPeriod` 型別斷言。網址帶 `?period=99m` → 標題印「99m」、`/analyze` 的 zod 擋下但 `/stock` 的 `period` 落回預設 `3m` → **同一頁的標題、AI 敘事與價位分屬三種持有期**。 | **Medium** |
| D-4 | **整套 toast 系統是死碼**。`use-toast.ts`(187 行) + `toaster.tsx` + `toast.tsx` + `sonner.tsx` 全部沒被掛載（`App.tsx` 無 `<Toaster />`），而錯誤提示用的是**三處原生 `alert()`**。 | **Medium** |
| D-5 | **`analysisCacheKey` 缺版本前綴**（對照 `dailyCache.ts:63-73` 的 stock 版有 `v{RULE_VERSION}`）。改 payload 結構後當天整天供應舊格式資料。 | **Medium** |
| D-6 | **`analysis.tsx` 的 useMemo 鏈全部失效**。`useQueries` 每次 render 回新陣列 → `derivedStockDetails` 每次重算 → 相依它的 `groupRanks`／`sortedStocks`／`identity`／`rankedRows` 全部連帶重算。 | **Low** |
| D-7 | **死碼**：`stock-card.tsx` 的 `roundTripCostPct`、`formatMaSignal`、`TrendingUp`、`AlertTriangle`、`ArrowRight`、`ShieldCheck` 各只出現 1 次（即只有 import／定義那行）。`chart.tsx`(366 行 recharts 封裝) 從未被任何頁面 import。`index.css` 整套 light mode 色票因 `forcedTheme="dark"` 永遠跑不到。 | **Low** |
| D-8 | 安全面**大致通過**：React 預設跳脫、無 `dangerouslySetInnerHTML`、外連有 `rel="noreferrer"`、CORS 預設全關。惟 `analysis.tsx:299` 的 `href={newsItems[c.source-1]?.url}` 直接吃模型輸出，`javascript:` 開頭的 URL 無過濾。 | **Low** |

---

## 3. 分項深度分析與問題診斷

### 3.1 JSON 資料層

#### 🔴 J-1｜Gemini 輸出零執行期驗證，缺一個 `name` 就整頁白屏——且壞資料被鎖進當日快取

`openapi.yaml:235-239` 宣告 `StockInfo` 的 `code/name/reason/sector` 全部 required。但 `analyze.ts:422-425` 的唯一檢查是 `Array.isArray`：

```ts
stocks: (Array.isArray(aiData.stocks) ? aiData.stocks : []).map((s) => ({
  ...s,                                              // ← 四個 required 欄位一個都沒驗
  reasonSource: normalizeSource(s.reasonSource, shownNews.length),
})),
```

`analyze.ts:148-153` 的 `generationConfig` 只設 `responseMimeType: "application/json"`，**沒有 `responseSchema`**，所以模型漏欄位不會被擋。前端也沒有任何執行期驗證——Orval 產的 zod schema（`lib/api-zod`）**從未被前端使用**。

失敗鏈：模型漏一筆的 `name` → 查產業關鍵字（非 4~6 位代號）走 `queriedStock.ts:37` 的 `s.name.trim()` → `TypeError` → 這個 throw 發生在 `analysis.tsx:147` 的 useMemo 內（render 期間）→ 無 ErrorBoundary → **整棵樹卸載，全白畫面**。

**最致命的是快取順序**：

```ts
await analysisCache.set(cacheKey, day, payload);   // ← 壞 payload 先入快取
res.json(payload);                                  //    才回應
```

這份壞資料已經寫進 Netlify Blobs 的當日快取（key = keyword+period+day），**整整一天所有人查同一個關鍵字都直接命中快取、繼續白屏**，重新整理與換裝置都沒用。

> 驗證員更正：模型把整筆寫成 `null` 反而是**安全失敗**——`normalizeSource(s.reasonSource)` 會先丟 TypeError 被 catch 接住回 500 且不寫快取。真正會穿透的只有「物件存在但缺 `name`」這一種。

#### 🔴 J-2｜FinMind 限流回空陣列被當成「值是零」，殘缺評分被鎖成當日答案

`finmind.ts:50-56` 對 `!res.ok`（含 402/429 限流）與 `status !== 200` **一律 `return []`**，不丟例外。前端 `useQueries` 對 3~5 檔同時發，每檔 6~7 個 FinMind 請求 → 一秒內 20~35 個並發，而免費層是不帶 token 300 次/小時、帶 token 600 次/小時。**限流是常態，不是例外。**

第 3 檔的 `MonthRevenue` 與 `InstitutionalInvestorsBuySell` 撞到 402：

| 項目 | 正常 | 限流後 |
|---|---|---|
| `revenueYoY` | +45% → 評分 **+3** | `null` → 當成 **0** |
| 外資籌碼 | 淨買超 → **+2** | `null` → 整段跳過 |
| 投信 | **+0.5** | 跳過 |
| `evScore` | **5.5** | **0** |
| 三情境 | (0.6/0.3/0.1) | (0.3/0.45/0.25) |
| `ev` | **+8.5%** | **+1.5%** |
| `evSignal` | `strong_buy` | `watch_positive` |

`currentPrice` 不是 null，所以這份被稀釋過的 payload 通過 `stock.ts:423` 的快取條件，被寫成「今天的答案」。**E(V) 是一個看起來完全正常的精確數字，沒有任何標記說它少算了兩項。** 使用者據此在排名表上挑掉了真正該買的那一檔。

#### 🟡 J-3｜「算不出來」與「算出來是零」共用同一個表示

`tradePlan.ts:238-255`：`atrPct === null` 時 `rBull/rBase/rBear` 全部被寫成 `0` → `ev = 0`（不是 null）→ `evSignal = 'watch_positive'`。

前端三處都只濾 `ev != null`，濾不掉 `ev === 0`：

```ts
analysis.tsx:140  const evA = derivedStockDetails[a.code]?.ev ?? -Infinity;  // 0 勝過任何負值
analysis.tsx:184  .filter((row) => row.detail?.ev != null),
history.ts:75     if (!detail || detail.ev == null) continue;
```

結果：一檔連收盤價都沒有的股票，在「期望值排名」表排第一列、現價欄印「—」、E(V) 印綠色的「0.00%」，排在真的算出 -1.2% 的四檔之上；卡片的三情境摺疊層還會畫出「多頭 30% +0.0% / 基準 45% +0.0% / 空頭 25% +0.0%」三條 bar。

> 驗證員更正：排名表「訊號」欄印的是紅色「不建議進場」（`deriveAdvice` 補算得 `planKind='none'`），所以畫面**不是全無線索**，但排序位置與綠色的 0.00% 仍然誤導。故降為 Medium。

#### 其餘 JSON 層發現

| 項目 | 位置 | 說明 |
|---|---|---|
| 前瞻驗證把「不建議進場」的計畫也送去對答案 | `verify.ts:72-88` | 污染卡片印的達標率 |
| 前瞻驗證不套用卡片宣告的兩個失效條件 | `outcome.ts:88-95` | 過期計畫仍算進達標率 |
| `localStorage` 滿了會自我鎖死且靜默丟棄 | `history.ts:144-158` | 三行 `setItem` 都沒有 try/catch |
| `stocks` 為空時渲染空區塊，還快取一天 | `analyze.ts:402` | |
| 快取的「日」用伺服器 UTC 算 | `dailyCache.ts:100-106` | 台北 08:00 翻日，收盤資料當天看不到 |
| 快取鍵帶 `period`，與週期無關的五年估值與全歷史股利被重抓三次 | `dailyCache.ts:71-73` | |

---

### 3.2 UI 資訊呈現層

#### 🟡 U-1｜台股工具用美股慣例：全站 20+ 處色彩語意與台灣相反

```css
/* index.css:156 */  --primary:     165 100% 39%;   /* 青綠 #00C795 → 用在「漲／多／買超」 */
/* index.css:168 */  --destructive: 355 100% 64%;   /* 紅   #FF4757 → 用在「跌／空／賣超」 */
```

台灣投資人在券商 App、證交所網站、財經台上，**紅一律是漲、綠一律是跌**，這是幾十年訓練出來的反射。受影響的位置（部分）：

| 位置 | 內容 | 現況 |
|---|---|---|
| `analysis.tsx:377` | E(V) `+3.42%` / `-1.87%` | 正 = 綠、負 = 紅 |
| `analysis.tsx:496,503` | 產業情緒「看多／看空」 | 看多 = 綠 |
| `home.tsx:393-394` | 查詢紀錄「● 看多／● 看空」 | 看多 = 綠 |
| `market-panel.tsx:66-67` | 「族群最強／最弱」 | **只有中文詞加顏色，無數字可自我更正** |
| `chips-panel.tsx:22-27` | 「持續加碼／持續減碼」 | 加碼 = 綠（台灣慣例綠 = 賣壓） |
| `price-map.tsx:24,29` | 停利線／停損線 | 停利 = 綠、停損 = 紅 |
| `stock-card.tsx:161-165` | `strong_buy` 徽章 | 綠底綠字 |

排名表的價值在「掃視」（作者自己在 `analysis.tsx:320-322` 註解過），而**掃視階段先進眼的是顏色不是數字**——`+3.42%` 印成青綠、`-1.87%` 印成紅色，掃過去紅色那兩列會被讀成「最強」。

最極端的一處是 `stock-card.tsx:257-268`：整張卡片視覺上最像好消息的那塊——**紅底、紅框、`text-xl` 紅色粗體「NT$ 12,340」**——內容是「照建議買 3 張，**最壞會賠**」。

#### 🟡 U-2｜`muted-foreground` 小字全站低於 WCAG AA

實算（WCAG 2.x 相對亮度，dark 是唯一會渲染的主題）：

| 搭配 | 對比 | AA 門檻 | 判定 |
|---|---|---|---|
| `muted-foreground` on `--card` | **4.03:1** | 4.5:1 | ❌ |
| `muted-foreground` on `--background` | **4.40:1** | 4.5:1 | ❌ |
| `muted-foreground` on `bg-muted` 實心 | **3.55:1** | 4.5:1 | ❌ |
| `muted-foreground` on `bg-muted/30` | **3.89:1** | 4.5:1 | ❌ |
| `--border` on `--card` | **1.06~1.24:1** | 3:1（非文字） | ❌ 輸入框邊界幾乎看不見 |

而 `muted-foreground` 正是**全站所有 `text-xs` 與 `text-[11px]` 說明文字的顏色**——小字 + 低對比是雙重打擊。`price-map.tsx` 的刻度標籤更小，而那正是使用者要抄去下單畫面的價差數字。

#### 其餘 UI 層發現

| 項目 | 位置 | 說明 |
|---|---|---|
| 「爆量」只由顏色承載 | `stock-card.tsx:378-387` | 色盲使用者拿不到 |
| 「新聞出處 #N」有外連圖示與連結配色，卻是不能點的 `span` | `stock-card.tsx:219-224` | 同頁 `analysis.tsx:299` 的同名元素是真連結 |
| 排名表包在 `overflow-hidden` 而非 `overflow-x-auto` | `analysis.tsx:326` | 窄螢幕是**靜默裁切**，不是可捲動 |
| 預設（新手）視圖下指標格永遠只有一格，右半整片空白 | `stock-card.tsx:362-397` | `newbie` 沒有 `ma_position`/`monthly_yoy`/`chips` |
| 法人買賣超兩套格式；`0` 被當缺資料；不足一張印「-0張」 | `stock-card.tsx:669-673` | `if (!qty) return '-'` 把 0 當 falsy |
| 相對強弱未四捨五入即 `toFixed(1)`，打平時印「-0.0%」配紅色下跌箭頭 | `market-panel.tsx:13-14` | |
| 自由現金流固定除以一億，中小型股印出「0.0 億」與「-0.0 億」 | `valuation-panel.tsx:207-217` | |
| 缺值符號混用半形 `-` 與全形 `—` | `stock-card.tsx:370,676,682` | 同一張卡片上不一致 |
| `lang="en"` 的中文站、強制深色卻沒宣告 `color-scheme` | `index.html:2` | 每次冷載入整頁白閃 |

---

### 3.3 UX 操作流程層

#### 🔴 X-1｜建議張數用**毛值**風險算、最壞虧損用**淨值**印——實際風險系統性超出使用者設定的上限

**三個獨立代理人（numeric / finance / contract）各自撞到這一項。** 這是本次最重要的發現。

```ts
// tradePlan.ts:316  —— 後端算的 riskPerLot：純價差、以 entryMid 為基準、不含費用
riskPerLot = Math.round((entryMid - stopLoss) * 1000)

// stock-card.tsx:135-141 —— 部位大小用它
const position = planPosition({ riskBudget, capital, riskPerLot, entryPrice: entryHigh, ... });

// stock-card.tsx:144-150 —— 但顯示的「最壞會賠」用另一個數字
const economics = lotEconomics({ entry: entryHigh, stop: stopLoss, ... });   // 扣兩趟手續費 + 證交稅
```

兩個數字有兩處落差：

1. **費用**——`lotEconomics` 扣掉買賣各一次 0.1425%（最低 20 元）與賣出 0.3% 證交稅
2. **進場價基準**——後端用 `entryMid`，`planPosition` 用 `entryHigh`。**整整半個進場區間的寬度沒被算進風險**（進場區 100~101 的例子裡是 500 元/張）

實例（進場區 100~101、停損 95、單筆風險上限 20,000 = 預設值）：

- 毛值 `riskPerLot = (100.5 − 95) × 1000 = 5,500` → `byRisk = floor(20000/5500) = 3 張`
- 淨值 `netRiskPerLot ≈ 6,573` → **3 張實際最壞賠 19,719**

只要毛值再小一點（5,000 → 4 張），畫面就會印出「照建議買 4 張，最壞會賠 **NT$ 26,292**」——**比使用者親手設定的 20,000 上限超出 31%**，而正下方第 562 行還同時顯示「⚠️ 已達單筆風險上限 (20,000)，限制投入張數」，明示上限已被執行。典型超額幅度 10~30%。

`stock-card.tsx:575-588` 的 0 張說明更直接自打嘴巴：**張數用毛值判定，解釋文案卻引用 `economics.netRiskPerLot`**。

諷刺的是，同一張卡片的 `524-546` 行註解已經完整論證過這件事（「成本同時吃掉獲利並放大虧損，實測十檔有四檔因此翻面」）——但那個結論**只套用到風報比，沒套用到部位大小**。

#### 🔴 X-2｜模型少給一個 `code`，全螢幕遮罩就永遠不會消失

模型回的 `stocks` 裡有一筆 `"code": null` → 後端無驗證直接吐出並**寫進當日快取** → 前端 `getStockDetailQueryOptions` 算出 `enabled: false` → **TanStack Query v5 對停用中的 query 恆為 `status: 'pending'`** → `q.isPending` 永遠 true → `isAnalyzing` 永遠 true。

結果：`fixed inset-0 z-50` 遮罩永遠不消失，進度條卡在 4/5 不動，而頁面自己的「返回首頁」按鈕（`analysis.tsx:194`，一般流內、無 z-index）**被遮罩蓋住點不到**。頁內沒有任何出口。`analysis.tsx:96` 的存檔條件也永遠不成立，這次查詢連紀錄都不會留下。因為結果已進快取，同一個關鍵字整天重試都會複製同一個死結。

#### 🔴 X-3｜個股明細失敗的卡片永遠停在**假的**載入骨架

5 檔裡 2 檔的 `/api/stock/{code}` 回 500（FinMind fetch 逾時、DNS 失敗、Function 逾時或前端斷網）。這兩個 query 是 `isError` 不是 `isPending`，遮罩正常關閉；但 `derivedStockDetails` 只收 `q.data`：

```ts
queries.forEach((q, i) => { if (q.data) map[code] = q.data; });   // isError 完全沒被用到
```

→ `detail` 是 `undefined` 而 `loading` 已是 false → `StockCard:51` 落進 `!detail` 分支 → 回傳 `animate-pulse` 骨架。

**畫面：三張完整卡片 + 兩塊永遠在呼吸閃爍的灰塊。沒有錯誤字樣、沒有重試按鈕，`retry: false` 連自動重試都關掉了。**

金錢面的後果更嚴重：排名表只列得出 3 檔並寫「期望值第 1/**3**」，首頁的「領先標的」也從倖存的 3 檔裡挑——**真正 E(V) 最高的那檔如果剛好是失敗的兩檔之一，使用者看到的「領先標的」就是錯的**，而畫面沒有一個字說「有 2 檔沒抓到」。

這個狀態還會被寫進快照：日後從查詢紀錄點回來，一個完全靜態的歷史頁上仍有兩塊永恆的「載入中」。

#### 🔴 X-4｜新股不足 60 個交易日 → `below_both` 防線失效，崩跌中的股票被判「可進場」

`20 ≤ N < 60` 根時（上市未滿三個月的新股，台股每年約三、四十檔）：`calcMA(closes,60)` 回 `null` → `maSignal = "insufficient_data"` → `calcEV` 走進 **else 分支，把這檔當成「站上均線」處理**。

一檔 2026 年 5 月上市的新股，現價 42、MA20 = 50（**已跌破月線 16%**）、ATR = 3：

```
entryLow  = roundToTick(min(max(50, 42−3), 42)) = 42
entryHigh = roundToTick(42) = 42          ← 區間退化成一個點
entryTiming = "now"
deriveAdvice → can_enter / immediate
```

畫面：綠色的「可進場 —— 現價 42 落在建議區間 **42 ~ 42** 之間」（讀起來也不成句），而同一張卡片右欄「均線位置」寫「資料不足」、趨勢依據寫「資料不足以判定趨勢」。

**同一檔股票只要多滿五天資料就會被判 `below_both`，變成「站回月線後的計畫（尚未成立）」+ `entryTiming: avoid`**——兩個完全相反的結論，差別只在 MA60 算不算得出來。

`tradePlan.test.ts` 的所有案例都給定明確的 `maSignal`，**從未餵 `"insufficient_data"` 進 `calcEV`**，所以 567 個測試抓不到。

#### 🔴 X-5｜股價用**原始股價**而非還原股價 → 除權息汙染 ATR／均線／報酬率／前瞻驗證

`stock.ts:162` 與 `outcome.ts:85` 都抓 FinMind 的 `TaiwanStockPrice`（原始股價），而非 `TaiwanStockPriceAdj`（還原股價）。**台股除息季正是 7~9 月。**

一檔 100 元、殖利率 7% 的股票，除息日跳空 −7：

1. **ATR 被墊高約 18%**（`TR = |min − prevClose| ≈ 7`，平時約 2），持續 14 個交易日 → 停損距離拉寬 18% → 建議張數少約 15%
2. **`maSignal` 極可能翻成 `below_both`** → 評分 −2、`entryTiming` 變 `avoid`、卡片標題變「站回月線後的計畫（尚未成立）」。公司基本面完全沒變，變的只是股利離開股價
3. **20/60 日報酬硬扣 7%**，`relativeStrength` 顯示「相對大盤 −6.x%」——把高殖利率股在除息季一律標成弱勢，而「**存股**」視圖的標的正好全是這種股票
4. **最嚴重**：`outcome.ts` 判定 `bar.min <= stopLoss` → 判成 `"stop"`。**那不是虧損，是配息落袋。** 卡片上「這套規則（v3）目前實測：達標率 X%」因此在除息季被系統性壓低——而前瞻驗證是這個產品用來校正那張未經回測機率表的**唯一手段**

> 驗證員更正：(1) 與 (2) 不會同時發生在同一檔上——跳空若大到翻轉 `maSignal`，評分下滑幅度通常大過 ATR 被墊高的影響，`ev` 反而往下掉。但 ATR/停損/張數失真、相對強弱失真、outcome 誤判三項完全成立。

#### 其餘 UX 層發現

| 項目 | 位置 | 說明 |
|---|---|---|
| 分析失敗只彈 `alert('分析失敗')`，丟掉後端寫好的真正原因 | `analysis.tsx:63-69` | 後端 `geminiErrors.ts` 已分類出配額用盡／金鑰無效／模型不可用，全被丟棄。等 20 秒換來一個沒有原因的系統對話框，然後被踢回首頁，輸入的關鍵字也沒了 |
| 前端沒有任何 timeout／AbortController／取消鍵 | `custom-fetch.ts:361-370` | |
| `/analyze` 沒有總體期限，而**配額在工作之前就先扣掉** | `analyze.ts:137-172` | 失敗也照樣消耗當日額度 |
| 查詢紀錄刪除鈕：`opacity-0` 不關閉 pointer events | `home.tsx:409-417` | 手機上「看不見但完全點得到」，誤觸即靜默刪除，無確認無 undo。鍵盤 Tab 唯一可聚焦的就是它，按 Enter 想「打開」實際是「刪除」 |
| 主要動作掛在 `<div onClick>` 上，無 `role`／`tabIndex`／`onKeyDown` | `home.tsx:386` | 鍵盤與螢幕閱讀器使用者**永遠打不開任何一筆歷史分析** |
| 四個金額輸入欄對螢幕閱讀器沒有名字，點標籤不會聚焦 | `number-field.tsx:53-66` | 無 `htmlFor`／`id` |
| 手機看不到期望值名次，卡片上卻印著方向相反的排名 | `analysis.tsx:324` | 桌機讀出「期望值最差」，手機讀出「族群最強」（`MarketPanel` 排的是 20 日報酬，兩把尺） |
| 摺疊與切換控制只有 16~20px 高 | `stock-card.tsx:315,459,513` | 低於 44px 觸控目標建議值 |
| 風險與資金上限同時卡死時一律歸咎於風險預算 | `settings.ts:191-197` | 給出照做也買不到 1 張的指示 |
| 快照寫入失敗無聲，點紀錄被彈回首頁而那一列永遠清不掉 | `history.ts:144-158` | |
| `evSignal` 絕對門檻套在會隨週期伸縮的 `ev` 上 | `tradePlan.ts:237-255` | 只切換週期就從「觀望偏多」變「買進」 |
| 「扣費後」數字的費率基準從未顯示 | `stock-card.tsx:493-505` | 預設 10 折（無折扣）會把有利交易標成「賠率不利」 |

---

## 4. 可執行的優化建議與改進方案

### P0 — 會造成錯誤金錢決策或畫面崩潰（建議一週內）

#### R-1｜部位大小改用淨風險（修 X-1）

`stock-card.tsx` 把 `economics` 移到 `position` 之前：

```ts
const economics = entryHigh && stopLoss && takeProfit ? lotEconomics({
  entry: entryHigh, stop: stopLoss, target: takeProfit,
  firstTarget, discount: settings.feeDiscount,
}) : null;

const position = planPosition({
  riskBudget: settings.riskBudget,
  capital: settings.capital,
  // 使用者設的是「這筆最多賠多少錢」，那是實際到手的虧損，不是價差。
  // 且進場價要與 economics 同基準（entryHigh），不能一個用 entryMid 一個用 entryHigh。
  // 缺 economics 時退回後端毛值，至少不會少一個保護。
  riskPerLot: economics?.netRiskPerLot ?? riskPerLot,
  entryPrice: entryHigh,
  maxPositionPct: settings.maxPositionPct,
});
```

改完後 `lots × netRiskPerLot` 恆 ≤ `riskBudget`，`562` 行的「已達單筆風險上限」與 `575` 行的 0 張說明才與判定依據一致。毛值保留在既有的「未扣費用的帳面數字」摺疊層。

**這一項務必補測試**——`stock-card` 目前沒有任何元件測試，可先在 `settings.test.ts` 加一組「淨值 > 毛值時張數必須減少」的斷言。

#### R-2｜加一層 ErrorBoundary + 後端驗證模型輸出（修 J-1、X-2）

```ts
// analyze.ts —— 過濾後為空就不入快取
const isValidStock = (s: unknown): s is StockInfo =>
  !!s && typeof s === "object" &&
  (["code", "name", "reason", "sector"] as const).every(
    (k) => typeof (s as Record<string, unknown>)[k] === "string" &&
           (s as Record<string, string>)[k].trim().length > 0) &&
  /^\d{4,6}$/.test((s as StockInfo).code);

stocks: (Array.isArray(aiData.stocks) ? aiData.stocks : [])
  .filter(isValidStock)
  .map((s) => ({ ...s, reasonSource: normalizeSource(s.reasonSource, shownNews.length) })),

// 並且
if (payload.stocks.length > 0) {
  await analysisCache.set(cacheKey, day, payload);   // 與 stock.ts:423「只快取成功結果」同一原則
}
```

搭配 `generationConfig` 加 `responseSchema`（Gemini 支援結構化輸出，可從 `openapi.yaml` 直接對應），從源頭消除這一類。

`App.tsx` 包一層 ErrorBoundary——程式碼裡三處註解已經寫了三次「沒有 ErrorBoundary」，補一個比繼續逐點防守便宜。

`isAnalyzing` 改用 `fetchStatus` 而非 `isPending`，並在遮罩內放一顆「取消並返回」按鈕。

#### R-3｜失敗的卡片要說自己失敗（修 X-3）

```tsx
// stock-card.tsx —— 拆開兩個分支
if (loading) return <骨架 />;
if (!detail) return <錯誤卡 code={stock.code} onRetry={onRetry} />;
```

`App.tsx` 對 queries 設 `retry: 2, retryDelay: 1000`（`analyze` 是 mutation 不受影響）。排名表與首頁「領先標的」旁標註「（N 檔資料未取得，未列入比較）」。

#### R-4｜讓「抓不到」可辨識（修 J-2、J-3）

```ts
// finmind.ts
export type FinMindResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: "rate_limited" | "http" | "network" };
```

`stock.ts` 收集失敗的資料集名稱，payload 加 `degraded: string[]`；**只有影響評分的三個資料集（price/revenue/institutional）全部成功才寫日快取**。卡片在 `degraded.length > 0` 時於 E(V) 旁印一行「本次籌碼／營收資料抓取失敗（額度限制），評分未計入這兩項」。

**少算一項而不說，比整塊不顯示嚴重得多。**

同時把 `atrPct === null` 的早退補上，讓 `ev` 在算不出來時是 `null` 而非 `0`（`openapi.yaml` 的 `ev`/`evSignal` 等本來就不在 required 清單，加 `nullable: true` 後前端既有的 `!= null` 判斷全部自動生效）。

#### R-5｜新股防線（修 X-4）

```ts
// tradePlan.ts:268
const maUnknown = input.maSignal === "insufficient_data";
const belowMa20 = currentPrice !== null && ma20 !== null && currentPrice < ma20;
if (input.maSignal === "below_both" || (maUnknown && belowMa20)) { /* avoid 分支 */ }
```

並在 `tradePlan.test.ts` 補一組 `maSignal: "insufficient_data", currentPrice: 42, ma20: 50` 鎖住行為。

#### R-6｜還原股價（修 X-5）

指標與驗證管線改用 `TaiwanStockPriceAdj`，顯示用的收盤價維持原始股價。Adj 需要較高權限的 token，抓不到時退回並在 payload 加 `priceSeriesAdjusted: false`，卡片顯示「近期有除權息，指標未還原」。

若不改資料集，最低限度用**已經抓回來的** `dividendResults`（含除息日）做兩件事：`calcATR` 對除息日的 bar 只取 `cur.max - cur.min` 不算跳空 TR；`evaluateOutcome` 對停損停利門檻做 `stopLoss - cumulativeDividend` 位移。

**兩者都要遞增 `RULE_VERSION` 與 `stockCacheKey` 版本前綴**，否則新舊快照會混進同一個達標率。

---

### P1 — 明顯誤導或體驗嚴重受損（建議一個月內）

#### R-7｜色彩語意在地化（修 U-1）

**不要動 `--primary` / `--destructive`**——前者兼品牌色＋按鈕＋焦點環，後者要留給真正的錯誤與破壞性動作。新增語意色票：

```css
@theme inline {
  --color-up:   hsl(var(--up));
  --color-down: hsl(var(--down));
}
:root  { --up: 0 74% 45%;  --down: 160 84% 30%; }
.dark  { --up: 0 90% 66%;  --down: 160 84% 45%; }
/* dark 實測：up #f65a5a 對 --card 5.64:1、down #12d393 對 --card 9.29:1，皆過 AA */
```

然後把「漲跌／多空／買賣超／正負期望值」全部換成 `text-up` / `text-down`，品牌與錯誤用途保留原樣。同時對純顏色標籤（`族群最強`、`持續加碼`）補上箭頭或 `+/-` 符號，讓色盲使用者也拿得到。

建議一併加設定切換（部分習慣美股的使用者會想要反過來）。

#### R-8｜對比度（修 U-2）

`--muted-foreground` 在 dark 從 `222 17% 50%` 提到約 `222 17% 62%`（對 `--card` 可達 6.1:1）；`--border` 從 `222 29% 15%` 提到約 `222 20% 26%`（對 `--card` 達 3.0:1）。`text-[11px]` 一律升到 `text-xs`(12px)，價位地圖的刻度標籤改用 `text-foreground/70`。

#### R-9｜免責聲明（修 B-2）

全站 footer（`App.tsx:32`）：

```tsx
<footer className="mt-auto border-t border-border px-4 py-4 text-xs text-muted-foreground text-center leading-relaxed">
  本站的進場區、停損停利、建議張數與損益試算，皆為依公開資料與固定規則產生的量化模擬結果，
  僅供研究參考，不構成任何證券投資建議或買賣要約。產業敘述含 AI 生成內容可能有誤，
  日線資料延遲一日。投資有風險，盈虧自負。
</footer>
```

決策點也要有（`stock-card.tsx` position sizing 盒最後一行，**永遠顯示、不受 profile 控制**）。並建議把 README 的「**可執行**的波段交易計畫」改成「可驗算的」。

#### R-10｜視圖開關要蓋住所有建立在該數字上的結論（修 B-3）

```tsx
// stock-card.tsx:232
{shows('expected_value') && evSignal && effectiveAdvice.planKind !== 'none' && (

// analysis.tsx —— import { shows } from '@workspace/view-profile'
{shows(profile, 'expected_value') && sortedStocks.length >= 2 && (
```

新手視圖若仍想保留排名表的橫向比較價值，改成只留「代號／公司／現價／操作建議」欄——那才符合「只看能不能買」的定位。

#### R-11｜前瞻驗證的統計誠實度（修 T-1、T-2）

```ts
// artifacts/web/src/lib/verifyStats.ts
export const MIN_DECIDED = 20;   // 經驗值，須在畫面上標明
/** Wilson 95% 區間 —— 小樣本下比常態近似誠實得多 */
export function wilson95(k: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const m = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, (c - m) * 100), Math.min(100, (c + m) * 100)];
}
```

`decided < MIN_DECIDED` 時不印百分比，改印「樣本不足（已結案 N 筆，需 20 筆才有參考價值）」。

驗證請求改為前端分批送（`BATCH = 40`）並在前端合併 `tally`；若配額吃緊，退而取**最舊**的 40 筆（`slice(-40)`）而非最新。

#### R-12｜錯誤提示改用已經裝好的 toast（修 D-4）

`App.tsx` 掛上 `<Toaster />`，三處 `alert()` 改成 toast，並把後端 `geminiErrors.ts` 已經分類好的原因帶到畫面上（「今日分析額度已用盡，明天再試」遠優於「分析失敗」）。同時**不要在分析失敗時把使用者踢回首頁並丟掉關鍵字**——留在原頁提供「重試」。

#### R-13｜術語註解（修 B-5）

用既有的 `hover-card.tsx` 做一個共用 `<Term>` 元件（桌機 hover、手機可點），先覆蓋最關鍵的五個：風報比、達標率、計畫成立率、相對強弱、均量。

#### R-14｜把假設印在結論旁邊（修 B-1）

```tsx
// stock-card.tsx，position sizing 盒下方
<p className="text-[11px] text-muted-foreground">
  依你的設定計算：可動用資金 NT$ {settings.capital.toLocaleString()}、
  單筆最大虧損 NT$ {settings.riskBudget.toLocaleString()}、
  單檔上限 {Math.round(settings.maxPositionPct * 100)}%。
  <a href="/" className="underline ml-1">改設定</a>
</p>
```

並把 `settings.ts` 註解裡**已經寫好的白話**搬上畫面（`NumberField` 加 `description` prop）——「帳戶裡現在能買股票的現金，不是總資產」這句話目前只有讀原始碼的人看得到。

#### R-15｜刪除與清除的安全性（修 B-6、X-6）

刪除鈕改用 `@media (hover: hover)` 而非永遠 `opacity-0`，並加 `aria-label` 與 44px 觸控區；「清除全部」用已經裝好的 `alert-dialog.tsx` 包起來，文案要提到「前瞻驗證的達標率也會一併歸零」；`verifyStore.ts` 補 `clearVerify()` 讓孤兒統計能一起清掉。歷史紀錄列的主要動作改成真正的 `<button>`。

---

### P2 — 打磨（有空再做）

- 數字格式：統一缺值符號（全用 `—`）、`formatInstitutional` 的 `if (!qty)` 改成 `if (qty == null)`（0 是有效資料）、`Math.round` 前先處理 `-0`、法人買賣超統一加千分位、估值帶的小數位與單位對齊
- `overflow-hidden` → `overflow-x-auto`（`analysis.tsx:326`）
- `lang="zh-Hant-TW"`、`<meta name="color-scheme" content="dark">`
- 清掉死碼：`roundTripCostPct`、`formatMaSignal`、五個未使用的 lucide icon、`chart.tsx`（或拿它做 R-16）、light mode 色票
- `analysisCacheKey` 補版本前綴
- 快取的「日」改用台北時區
- `useMemo` 鏈：把 `derivedStockDetails` 的相依從 `queries` 改成穩定的 key
- 移除 `roundTripCostPct` 等未使用匯入後跑一次 `pnpm run typecheck`

---

### 值得考慮的產品方向（非缺陷）

| 方向 | 理由 | 後續 |
|---|---|---|
| **R-16｜K 線圖** | `chart.tsx`（366 行 recharts 封裝）已經在專案裡但從未使用。`price-map.tsx` 已經解決了「價位相對位置」，缺的是「走勢形狀」。需要 API 增加 OHLC 序列——`stock.ts` 本來就抓了完整日線，只是沒回傳。**這是投入產出比最高的一項功能**。 | ✅ **2026-08-07 完成**，但**不是 K 線**：實測繪圖區在手機上只有 117px，60 根蠟燭每根 1.95px。改為在 price-map 背後畫收盤價折線。見 [spec](superpowers/specs/2026-08-07-price-map-trend-design.md) |
| **R-17｜Payload 分層** | `StockDetailResult` 有 50+ 欄位，把「幾乎不變」（公司名、官方產業別、股利歷史、估值區間、財報）與「會變」（現價、成交量、法人）混在同一個物件。日線延遲一天的前提下現在這樣可以，但**一旦想加即時報價就是重寫**。建議先拆成 `static / daily / realtime` 三層。 | ❌ **2026-08-07 評估後不做**。實測「真正幾乎不變」的部分只佔 payload 4.3%（185 / 4,328 bytes），抽層只省 45 KB／1.03 MB，而快照離 5 MB 上限還很遠。**本報告這一項的前提不成立**，理由詳見 [spec](superpowers/specs/2026-08-07-finmind-request-budget-design.md) |
| **R-18｜批次端點** | 把 5 檔的 stock 請求改成 `/api/stocks?codes=…`，內部用併發上限 4 的佇列並對 402 做退避重試。目前前後端都沒有任何節流、佇列或退避——這是 J-2 的根因。 | ⚠️ **2026-08-07 改以另一種方式完成**。402 是**每小時額度**用盡而非瞬時併發，批次化不減少總量卻會廢掉逐卡重試。改為減少請求本身：快取 `resolveStock`、估值與股利移到延後載入。**36 → 26／21**（−28%／−42%） |
| **R-19｜元件測試** | 567 個測試沒有一個碰到 React。本報告 8 項 High 沒有一項會被現有測試抓到。建議先補三個：`StockCard` 在 `detail === undefined` 時的行為、`planPosition` 的淨值上限、`Analysis` 頁在部分 query 失敗時的渲染。 | ⚠️ 部分達成：把判斷從元件抽成純函式（`lib/position`、`lib/apiError`、`lib/verifyStats`、`lib/format`、`buildTrend`）並全部測到，但**仍無元件測試基礎建設**（無 jsdom／testing-library） |

---

## 附錄：測試方法與可信度

- **10 個維度平行掃描**，每個維度的發現立刻進入獨立的對抗式驗證（`pipeline`，非 barrier）
- **驗證員的預設立場是「駁回」**——必須親自用 Read/Grep 打開被引用的檔案行號、確認程式碼真的長那樣、且推論真的成立，才判 `real: true`
- 驗證員除了駁回 2 項，還**主動更正了 5 項描述過當**（例如：ChipsPanel 其實不會消失、除息跳空的兩個後果不會同時發生、`code` 為空字串與 `null` 的路徑不同），這些更正已併入本報告
- 統計：20 個代理人、675 次工具呼叫、35 分鐘、240 萬 token

**本報告未修改任何程式碼。**
