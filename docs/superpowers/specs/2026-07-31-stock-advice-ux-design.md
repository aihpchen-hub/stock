# 個股分析改善設計

日期：2026-07-31
範圍：使用者提出的 13 項網站改善建議

## 摘要

13 項建議中，**2 項已經實作完成**（第 6 項風險報酬比、第 13 項歷史績效），
**1 項是真實缺陷**（第 1 項，根因已定位），其餘 10 項可行且不需要新增外部資料源。

實作分三階段，每階段各自可上線。

## 現況盤點

| 項 | 需求 | 現況 |
|---|---|---|
| 1 | 建議買價與現價邏輯矛盾 | **缺陷**，根因見下節 |
| 2 | 目前操作建議 | `entryTiming` 已算出，前端從未使用 |
| 3 | 法人籌碼多天期 | 只有 30 日累計 |
| 4 | 推薦依據 | 無。MACD／KD 未計算，均線只有 MA20／MA60 |
| 5 | 資料更新時間 | `priceAsOf` 已算出，未顯示 |
| 6 | 風險報酬比 | **已完成**（`riskRewardRatio`，stock-card.tsx 已顯示）。可補「扣費後」 |
| 7 | 停損依據 | 純 ATR 波動停損。`swingLow` 已算出，未顯示 |
| 8 | 趨勢判斷 | 只有 `maSignal` 三態，無斜率 |
| 9 | 成交量分析 | `avgVolume20` 已算出，缺當日量與比值 |
| 10 | 策略類型 | `period` 與 `horizonFactor` 已有，缺標籤 |
| 11 | 分析失效條件 | 無 |
| 12 | AI 分析摘要 | 無 |
| 13 | 歷史績效／回測 | **已完成**（home.tsx「對答案」前瞻驗證） |

## 已確認的決策

1. **維持日線資料，不接即時報價。** 修正邏輯矛盾即可，並在每個價位標注基準交易日。
2. **綜合評分改用 20 日籌碼 + 近期趨勢修正**，取代現行的 30 日累計。
3. **停損維持現有 ATR 演算法**，改為誠實說明其依據，並並列前低與月線作為結構性對照。

## 第 1 項的根因

`artifacts/api-server/src/lib/tradePlan.ts:176-187`：

```
if (maSignal === "below_both") {
  entryLow  = roundToTick(ma20);
  entryHigh = roundToTick(ma20 + 0.3 * atr);
} else { ... }
stopLoss = roundToTick(entryMid + BEAR_ATR_MULTIPLE * atr * factor);
```

跌破雙均線時，進場區間被設為 `MA20 ~ MA20+0.3ATR`，**必定高於現價**；
停損則是 `進場中值 − 2×ATR×係數`。當股價跌破 MA20 超過約 2.15 個 ATR 時，
現價就會低於停損價 —— 這正是使用者回報的組合。

`above` 分支的 `entryHigh` 恆等於 `currentPrice`，因此不可能產生「買價高於現價」。
所有回報案例都出自 `below_both` 分支。

**根本問題不是數字算錯，而是同一組欄位承載了兩種語意**：
`entryLow/entryHigh` 在此分支代表「**假如**站回月線後的進場區」，
但畫面把它當成「現在的建議買價」印出。`entryTiming` 欄位當下的值已經是 `avoid`，
只是前端從未讀取。

## 架構

### 後端新模組

現有 `stock.ts`（216 行）、`tradePlan.ts`（234 行）已接近單一檔案應承擔的上限，
新增計算另立模組，各自純函式、可獨立測試，沿用現有「資料不足回傳 null」的慣例。

| 模組 | 職責 | 對應項目 |
|---|---|---|
| `indicators.ts`（擴充） | EMA、MACD、KD、均線斜率、量能剖面 | 4, 8, 9 |
| `chips.ts`（新） | 法人籌碼多天期彙總、趨勢、連買天數 | 3 |
| `signals.ts`（新） | 由指標推出可顯示的訊號清單與趨勢判定 | 4, 8, 9 |
| `advice.ts`（新） | 操作建議狀態機、計畫種類、失效條件 | 1, 2, 11 |
| `narrative.ts`（新） | 由已算出的欄位組出中文摘要 | 12 |
| `tradePlan.ts`（改） | `calcScore` 改用 20 日 + 趨勢修正 | 3 |

### 前端拆檔

`stock-card.tsx` 現為 272 行，加入全部新區塊後會達 600 行以上，拆為：

- `stock-card.tsx` —— 外殼與組裝
- `components/stock/advice-banner.tsx` —— 項目 1, 2
- `components/stock/signal-list.tsx` —— 項目 4
- `components/stock/chip-panel.tsx` —— 項目 3
- `components/stock/trade-plan.tsx` —— 項目 6, 7, 11
- `components/stock/narrative.tsx` —— 項目 12
- `components/data-freshness.tsx` —— 項目 5

天期切換為純前端狀態：後端一次回傳 1／5／10／20 日四個視窗，切換不重新請求。

## 第一階段：修正矛盾與顯示狀態（項目 1, 2, 5, 10）

### 計畫種類

新增 `planKind`，把「交易計畫」與「現在能不能買」分成兩件事陳述：

| planKind | 意義 |
|---|---|
| `immediate` | 進場區間包含現價，現在可掛單 |
| `pullback` | 進場區間在現價之下，等回檔 |
| `conditional` | 進場區間在現價之上，**尚未成立**（現行 `below_both` 分支） |
| `none` | 資料不足 |

### 操作建議狀態機

由上往下取第一個成立者：

| 序 | 條件 | action | planKind | 畫面文字 |
|---|---|---|---|---|
| 1 | 缺 `atr`／`currentPrice`／`ma20` | `insufficient_data` | `none` | ⚠️ 資料不足，無法給建議 |
| 2 | `currentPrice <= stopLoss` | `stop_breached` | `none` | ❌ 現價 X 已低於停損 Y，不建議進場 |
| 3 | `maSignal === "below_both"` | `wait_breakout` | `conditional` | ⏳ 等待突破 —— 站回月線 X 元才成立 |
| 4 | `currentPrice − ma20 > 2×atr` | `wait_pullback` | `pullback` | ⏳ 等待回檔至 X ~ Y |
| 5 | 其餘 | `can_enter` | `immediate` | ✅ 可進場（現價 X 落在 Y ~ Z） |

**排序至關重要，且與直覺相反：「跌破停損」必須排在「跌破均線」之前。**

反過來排會讓 `stop_breached` 永遠不可達，因為兩個矛盾價位只在 `below_both`
分支同時出現 —— 先攔截 `below_both` 就等於把使用者回報的那個案例吞掉。
（在站上均線的分支，`entryHigh` 恆等於 `currentPrice`，
而 `stopLoss = entryMid − 2×ATR×係數` 且 `entryMid <= currentPrice`，
故 `stopLoss < currentPrice` 恆成立，`stop_breached` 在該分支本就不可能發生。）

排定之後，第 3 條的三個價位變成互相一致的：
`stopLoss < currentPrice < entryLow <= entryHigh`。
語意是「現在 X 元，等站回 `entryLow` 才進場，屆時停損掛在 `stopLoss`」——
停損在現價之下，沒有任何矛盾。
因此 `conditional` 的計畫**照常顯示**，只是標題改為
「站回月線後的計畫（尚未成立）」而非「建議買價」。

只有第 2 條（現價已跌破停損）會**完全隱藏**進場區、停損與停利，
僅顯示狀態與現價 —— 那份計畫的前提已經不存在，印出來只會誤導。

### 追高分支的進場區間修正

第 4 條（`wait_pullback`）現行的進場區間是
`[max(ma20, currentPrice − atr), currentPrice]` —— **上緣就是現價**。
一邊說「等待回檔」一邊給出含現價的區間，是同一類矛盾的較輕版本。

修正：判定為追高時，上緣改為 `roundToTick(currentPrice − 0.3×atr)`，
使區間確實落在現價之下，`planKind` 因而名副其實為 `pullback`。

**後果**：追高個股的 `entryHigh` 下移，連帶 `entryMid`、`stopLoss`、
`takeProfit`、`riskRewardRatio` 與建議張數皆隨之改變。
此為刻意變更，依下方「規則版本」一節標記為 `ruleVersion: 2`。

### 資料日期（項目 5）

股價、法人、營收三個來源的最新日期不一定相同，
單一「更新時間」會蓋掉這個差異。回傳三個獨立欄位：

- `priceAsOf` —— 已存在
- `chipsAsOf` —— 法人資料最後日期
- `revenueAsOf` —— 最近月營收所屬年月

每個價位旁標注「基準：收盤 MM/DD」。卡片頂端一列並列三個來源的日期。

### 策略類型（項目 10）

由 `period` 直接對應，不需新計算：1m→短線（約 1 個月）、3m→波段（約 3 個月）、6m→中長線（約 6 個月）。

## 第二階段：指標與籌碼（項目 3, 4, 8, 9）

### 資料視窗調整

| 資料集 | 現行 | 調整後 | 原因 |
|---|---|---|---|
| `TaiwanStockPrice` | 150 日曆日（≈102 根） | 240 日曆日（≈163 根） | MACD 的 EMA26 需約 78 根才穩定，102 根不寬裕；MA60 亦更穩 |
| `TaiwanStockInstitutionalInvestorsBuySell` | 35 日曆日（≈23 交易日） | 45 日曆日（≈31 交易日） | 要穩定取到 20 個交易日，遇連假時 23 根不夠 |

兩者皆為既有呼叫的參數調整，**不新增任何 API 請求**。

### indicators.ts 擴充

```
calcEMA(values, period)                    → number | null
calcMACD(closes, 12, 26, 9)                → { dif, dea, osc, cross } | null
calcKD(rows, 9, 3, 3)                      → { k, d, cross } | null
calcMASlope(closes, period, lookback=5)    → number | null   // 百分比
calcVolumeProfile(rows)                    → { latest, avg5, avg20, ratio, kind } | null
```

`cross` 僅在最近 3 根內發生交叉時為 `"golden"` / `"dead"`，其餘為 `null` ——
交叉是事件不是狀態，永遠回報「目前 DIF 在 DEA 之上」會讓三個月前的交叉今天仍顯示為新訊號。

`kind`：`surge`（≥2×）、`expanding`（1.3~2×）、`normal`（0.7~1.3×）、`shrinking`（<0.7×）。

### chips.ts

```
aggregateChips(rows, windows=[1,5,10,20])  → Record<window, { foreign, trust, dealer }>
chipTrend(avg5, avg20)                     → "accumulating" | "neutral" | "distributing"
consecutiveDays(dailyNets)                 → number   // 正=連買天數，負=連賣天數
```

視窗以**交易日**切分，不是日曆日 —— FinMind 只回傳有交易的日期，
直接取日曆日會在連假後少算。法人分類沿用現行對應：
`Foreign_Investor` + `Foreign_Dealer_Self` = 外資，
`Investment_Trust` = 投信，
`Dealer_self` + `Dealer_Hedging` = 自營商。

### 評分改版

現行 `calcScore` 以 30 日累計計分。改為 20 日基準，門檻按比例調整（30 日→20 日約為 2/3），
再加趨勢修正：

| 項目 | 現行（30 日） | 改版（20 日） |
|---|---|---|
| 外資 | >2000 張 +2／>0 +1／<-2000 -2／<0 -1 | >1300 張 +2／>0 +1／<-1300 -2／<0 -1 |
| 投信 | >500 張 +0.5／<-500 -0.5 | >350 張 +0.5／<-350 -0.5 |
| 趨勢修正 | 無 | `accumulating` +0.5／`distributing` -0.5 |

總分範圍由 -7~7 變為 -7.5~7.5。
**`scenarioProbabilities` 的分段門檻（4／2／0／-2）維持不動** ——
同時改動兩個未經驗證的參數，日後結果變化將無從歸因。

評分改版會改變所有個股的 EV、訊號、停損與停利，
依下方「規則版本」一節標記為 `ruleVersion: 3`。

### signals.ts

`detectSignals(input) → Signal[]`，每筆為
`{ key, label, direction: "bullish" | "bearish", detail }`。

| key | 條件 | label |
|---|---|---|
| `ma_bull_stack` | MA5 > MA10 > MA20 > MA60 | 均線多頭排列 |
| `ma_bear_stack` | MA5 < MA10 < MA20 < MA60 | 均線空頭排列 |
| `macd_golden` | DIF 上穿 DEA（最近 3 根內） | MACD 黃金交叉 |
| `macd_dead` | DIF 下穿 DEA（最近 3 根內） | MACD 死亡交叉 |
| `kd_golden` | K 上穿 D 且 K < 80 | KD 黃金交叉 |
| `kd_dead` | K 下穿 D 且 K > 20 | KD 死亡交叉 |
| `kd_overbought` | K > 80 | KD 高檔鈍化 |
| `foreign_streak` | 外資連買 ≥ 3 日 | 外資連買 N 日 |
| `trust_streak` | 投信連買 ≥ 3 日 | 投信連買 N 日 |
| `volume_surge` | 量 ≥ 2× 20 日均量 | 爆量 |
| `volume_breakout` | 量 ≥ 1.3× 且**收盤價**創近 20 個交易日收盤新高 | 量增突破 |
| `volume_dry` | 量 < 0.7× 20 日均量 | 量縮整理 |
| `revenue_growth` | 月營收 YoY > 30% | 營收年增 X% |

`detectTrend(...)` → `{ trend, basis }`：

- `uptrend`：MA20 > MA60 且 MA20 斜率 > 0 且 收盤 > MA20
- `downtrend`：MA20 < MA60 且 MA20 斜率 < 0 且 收盤 < MA20
- `range`：其餘

**這些訊號只做顯示，不進入評分公式。** 評分本就是未經回測的經驗設定，
再塞入五個同樣未驗證的權重只會讓它更難歸因。
訊號的價值在於讓使用者看見判斷依據，顯示即已達成該目的。

### 命名修正

使用者原提「AI 推薦原因」。這批訊號全部由程式規則算出，並非模型判斷 ——
且現行 Gemini 呼叫發生在抓取個股資料**之前**，模型從未看過任何價格數字，
要它列出這些條件必然產生幻覺。畫面用語定為**「訊號依據」**，
每一條都可由回傳的數值驗算。

## 第三階段：敘述與風控（項目 6, 7, 11, 12）

### advice.ts 的失效條件（項目 11）

```
invalidation: {
  priceLevel: number | null
  priceReason: string
  expiresAfterTradingDays: number
  expiryReason: string
}
```

- 價格失效：`immediate` / `pullback` → 跌破 `stopLoss`；`conditional` → 跌破 `swingLow`
- 時間失效：1m→10 個交易日、3m→20、6m→30 未進場即失效

時間門檻為經驗值，畫面標示「未經驗證」，
與現有「三情境機率未經回測」的標示做法一致。

### 停損依據（項目 7）

演算法不變，改為回傳結構化說明：

```
stopBasis: {
  method: "atr_volatility",
  text: "進場中值 −2×ATR(14)×時間尺度係數 1.00",
  atr: 3.2,
  reference: { swingLow: 118.5, ma20: 122.0 }
}
```

`swingLow` 與 `ma20` 皆已計算，僅未顯示。
畫面：`停損 115.0　依據：2 倍日均波動（ATR 3.2）｜近 20 日低 118.5、月線 122.0`。

不改為結構性停損：前低是任意選定的結構（為何是 20 日而非 10 或 60 日？），
換上去會同時改變風報比與建議張數，卻沒有任何驗證支撐該選擇。

### 淨風報比（項目 6）

現有 `riskRewardRatio` 為毛值。`artifacts/web/src/lib/fees.ts` 的 `lotEconomics`
已能算出扣除手續費與證交稅後的每張損益，前端加一行「扣費後 X.XX」。
**純前端變更，後端不動。**

### narrative.ts（項目 12）

模板組句，**不呼叫 Gemini**：

```
{名稱}目前{趨勢}，{操作建議}。{最多 3 個看多訊號}；{最多 2 個看空訊號}。
籌碼面外資近 5 日{買/賣}超 X 張，{籌碼趨勢}。
建議進場區 {X~Y}，停損 {Z}（風報比 R），適合{策略類型}操作。
```

只使用已算出的欄位組句，因此永遠不會與畫面上的數字牴觸。
任一欄位缺席時該段整句略過，不編造內容。

不採用模型生成的理由：`/analyze` 現已耗時 16~20 秒，
Gemini 免費額度是本專案最主要的限制；
要模型撰寫個股摘要需在取得個股資料後再發一輪請求，
增加延遲與額度消耗，且模型敘述容易與上方數字互相矛盾。

## 規則版本

第一與第二階段都會改變已顯示的數字，而「對答案」（`home.tsx` 前瞻驗證）
是把**當時存下的**計畫拿去對後來的真實走勢。
新舊規則的結果若混進同一個達標率，統計會失去意義卻看不出來。

回應中加入 `ruleVersion` 並存入快照：

| 版本 | 起始於 | 差異 |
|---|---|---|
| 1 | 現況（快照中無此欄位者視為 1） | — |
| 2 | 第一階段 | 追高分支的 `entryHigh` 下移 0.3×ATR |
| 3 | 第二階段 | 評分改用 20 日籌碼 + 趨勢修正 |

「對答案」的統計表格依版本分列。單一版本的樣本數不足時照常顯示，
但不合併計算 —— 現行 `targetRate` 在無已結案筆數時回 `null` 而非假裝 0%，
分版本後沿用同一個原則。

## 契約與相容性

- 全部新欄位加入 `lib/api-spec/openapi.yaml`，**一律為 optional**（舊快照不含這些欄位）
- 執行 `pnpm --filter @workspace/api-spec run codegen` 重新產生 hooks 與 zod schema
- 個股快取鍵加版本前綴（`stock|v2|<code>|<period>`），
  避免部署當天讀到缺少新欄位的舊 payload
- 前端每個新區塊在對應欄位缺席時整塊不渲染，
  不顯示 `-` 或 `undefined`；歷史快照因此仍可正常開啟

## 測試

沿用現有 vitest 設定，全部為不呼叫外部 API 的純函式測試。

| 檔案 | 涵蓋 |
|---|---|
| `indicators.test.ts`（擴充） | MACD／KD 以已知答案的 fixture 驗證；資料不足回 null |
| `chips.test.ts`（新） | 交易日視窗切分、連買天數、跨週末與連假 |
| `signals.test.ts`（新） | 每條規則的邊界值 |
| `advice.test.ts`（新） | 狀態機各分支 |
| `narrative.test.ts`（新） | 欄位缺席時不產生破碎句子 |
| `tradePlan.test.ts`（更新） | 評分改版後的分數與門檻 |

`advice.test.ts` 必須包含三個直接鎖住本次缺陷的案例：

1. **跌破雙均線且現價低於停損價** → 必須回 `stop_breached` 且 `planKind === "none"`，
   不得輸出任何進場區間。
2. **跌破雙均線但現價仍高於停損價** → 必須回 `wait_breakout`，
   且斷言 `stopLoss < currentPrice < entryLow` 三者順序成立。
   此案例證明狀態機的排序正確 —— 若把 `below_both` 判斷排到停損檢查之前，
   案例 1 會誤落到這一格。
3. **追高（`currentPrice − ma20 > 2×atr`）** → 必須回 `wait_pullback`
   且 `entryHigh < currentPrice`。

## 不做的事

- 不接即時報價（已確認維持日線）
- **不改停損公式**。`stopLoss = entryMid − 2×ATR×係數` 維持不變；
  追高分支的停損數值會變，但那是 `entryMid` 下移的結果，不是公式改了
- 不改為結構性停損（前低）
- 不把新訊號放進評分公式
- 不新增模型呼叫
- 不改 `scenarioProbabilities` 的機率分段
- 不改 `bullAtrMultiple` 與 `horizonFactor`

## 實作切分

三個階段各自撰寫獨立的實作計畫並分別上線。
不合併成單一變更的理由：第二階段會改動評分，
若與第一階段的缺陷修正混在同一次變更，
日後發現 EV 分佈異常時將無法區分成因是進場邏輯還是評分改版。
