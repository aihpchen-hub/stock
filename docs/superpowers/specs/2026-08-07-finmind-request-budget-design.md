# 降低 FinMind 請求量

**日期**：2026-08-07
**範圍**：子專案 2（共兩個）。子專案 1 是價位地圖走勢，已完成。

## 先講一個被推翻的前提

原訂範圍是 R-17（payload 分成 static / daily 兩層）+ R-18（批次端點）。實測之後**兩者都不做原本的樣子**。

### R-17：不做

用真實欄位結構組一份代表性 payload 量出來：

| 區塊 | bytes | 佔比 |
|---|---|---|
| 單檔 payload 總計 | 4,328 | 100% |
| revenueHistory | 841 | 19.4% |
| signals | 661 | 15.3% |
| priceSeries | 324 | 7.5% |
| chips | 310 | 7.2% |
| valuation | 295 | 6.8% |
| **真正「幾乎不變」的（公司身分＋股利摘要）** | **185** | **4.3%** |

抽出靜態層只省 45 KB／1.03 MB，卻要多一個端點、多一層快取、前端要做 join、還要處理舊快照相容。而 50 筆快照共 1.03 MB，對上 localStorage 5 MB 的上限離牆還很遠。

另一個理由「要即時更新現價就得整包重傳」也站不住：這個產品的日線**刻意**延遲一天，README 明寫「不適合當日操作」。為一個與產品定位矛盾的功能先做架構，是投機。

**結論：R-17 的成本大於收益，不做。** 量測腳本的數字留在本文件，日後若真要加即時報價，重新評估。

### R-18：做，但不是批次端點

402 是**每小時額度**用盡，不是瞬時併發限制。批次化不會減少一小時內的總請求數，卻會把前端從 `useQueries`（逐檔快取、逐檔重試、漸進渲染）改成單一 query —— 那會廢掉剛做好的逐卡重試與失敗標示。

真正該做的是**不要發不需要的請求**。

## 現況：一次分析 36 個 FinMind 請求

| 資料集 | 每次分析（5 檔） | 誰需要 |
|---|---|---|
| TaiwanStockPrice | 5 | 全部 |
| TaiwanStockMonthRevenue | 5 | 評分 |
| TaiwanStockInstitutionalInvestorsBuySell | 5 | 評分 |
| TaiwanStockInfo（`resolveStock`） | 5 | 全部，但**完全沒有快取** |
| TaiwanStockPER | 5 | 只有 `value`／`dividend` 視圖 |
| TaiwanStockDividend | 5 | 只有 `value`／`dividend` 視圖 |
| TaiwanStockDividendResult | 5 | 除息 ATR 修正（**必要**）＋股利面板 |
| TaiwanStockPrice（TAIEX） | 1 | 已日快取 |
| **合計** | **36** | |

免費層帶 token 是 600 次/小時 → 每小時只撐得住 16 次分析。而 `degraded` 的結果依設計不入快取，重試又是全額成本。

## 決策

### 一、快取 `resolveStock`

公司簡稱與官方產業別是全系統最靜態的資料（一年變動幾次），卻是唯一每次請求都重抓的。改用既有的 `dailyCacheFor` + 新的 `stockInfoCacheKey(code)`。

`resolveStock` 目前直接呼叫 `fetch` 而非 `fetchFinMindResult`，一併改掉——失敗原因目前完全看不到。

**省 5 個請求／次分析**，且同一檔當天之後完全免費。

### 二、PER 與 Dividend 移到延後載入的 `/stock/{code}/fundamentals`

作者在 `openapi.yaml` 對該端點寫的理由原文：

> 刻意不放進 `/stock/{code}` 的主流程：那裡已有六個 FinMind 請求，再加三張報表就是一次分析 27~45 個請求，尖峰會直接打到首次查詢。只有價值與存股兩個視圖需要，由前端在切到那些視圖時才請求。

同一個推理完全適用於 PER 與 Dividend——查 `VIEW_CONFIG` 可證：`valuation` 與 `dividend` 兩個區塊只出現在 `value` 與 `dividend` 視圖，而**預設是 `newbie`，兩者都不看**。

`DividendResult` 留在主流程：除息日是 ATR 修正要用的，那是每一種視圖都會影響到的計算。

**省 10 個請求／次分析。**

### 三、不動的部分

- 不加批次端點（見上）
- 不刪 payload 裡沒被渲染的欄位。掃描確認有 11 個（`revenueHistory`、`macd`、`kd`、`evScore`、`atr`、`atrPct`、`entryTiming`、`foreignNetDays`、`trustNetDays`、`institutionalNet30d`、`dealerNet30d`）。其中 `foreignNetDays`／`trustNetDays` 的產生處有註解說明它們為何重要（「+91 張在不知道這檔一天成交 100 張還是 100,000 張時毫無意義」）——那些是**沒接上畫面的功能**，不是死重。payload 不是瓶頸（1.03 MB／5 MB），刪它們沒有收益，而刪掉等於刪掉一個好想法。列在此供日後決定。

## 結果

一次分析 **36 → 21** 個請求（−42%），當天重複查詢的個股再降。每小時可支撐的分析次數從 16 提升到 28。

## 契約變更

`StockDetailResult` 的 `valuation` 與 `dividend` 移到 `Financials`（`/stock/{code}/fundamentals` 的回傳）。

**兩者在 `StockDetailResult` 上保留為 optional 且標記為 deprecated** —— localStorage 裡的舊快照有這兩個欄位，前端優先用延後載入的結果、退回快照存下的值。這與 `advice`／`invalidation`／`chips` 既有的向後相容做法一致。

`stockCacheKey` v8→v9、`fundamentalsCacheKey` v1→v2。**不動 `RULE_VERSION`** —— 搬移顯示欄位不改變任何計算。

## 降級

| 情況 | 行為 |
|---|---|
| fundamentals 抓取失敗 | 已有的行為：回空 `quarters`，不回 500。新增的 `valuation`／`dividend` 同樣可為 null，面板各自不渲染 |
| 舊快照 | 用快照存下的 `valuation`／`dividend` |
| 使用者從未切到 value／dividend 視圖 | 那三個資料集永遠不會被抓 |

## 測試

- `stockInfo.test.ts`（新檔）：命中快取時不發請求、失敗時回 null 且不寫快取、`fetchFinMindResult` 的失敗原因有被記錄
- `dailyCache.test.ts`：`stockInfoCacheKey` 帶版本前綴
- `fundamentals` 的 valuation／dividend 組裝沿用既有的 `valuation.test.ts`／`dividend.test.ts`，純函式不變
- 前端：`stock-card` 的面板改吃延後載入結果 —— 無元件測試基礎建設，靠 typecheck 與 build 驗證

## 驗收

- `pnpm test` 全綠且測試數增加
- `pnpm run typecheck` 乾淨、`pnpm run build` 成功
- 主流程的 FinMind 請求數可由程式碼直接數出為 4（Price／MonthRevenue／Institutional／DividendResult）+ 快取的 StockInfo
