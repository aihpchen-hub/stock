# 零股支援

**日期**：2026-08-07
**範圍**：買不到 1 張時，改以股數給出部位建議。純前端。

## 要解決的問題

高價股用預設設定幾乎都算出 0 張。預設是可動用資金 100 萬、單筆最大虧損 2 萬、
單檔上限 30%；一檔 NT$1,000 的股票，一張成本 100 萬，已經超過單檔上限 30 萬，
`byCapital` 直接是 0。

畫面現在的反應是印「建議張數 0 張／投入金額 NT$ 0」，加上一段說明為什麼買不到，
最後一句是「台股一張 1000 股，本工具尚未支援零股」。新手橫幅那一格更糟——
它退回去印「**每張**最壞會賠 NT$ 90,076」，一個既嚇人又無法執行的數字。

台股 2020 年起有盤中零股交易，這個限制沒有理由存在。

## 兩個已定案的決策

**一、只在買不到 1 張時給零股建議。** 算得出整張就維持現狀，畫面一字不變。
一律精算到股的話，NT$50 的股票會從「6 張」變成「6 張 + 968 股」，
每張卡片都變成兩筆下單，而零股是另一個撮合市場、成交價未必跟整股一致。
外科手術，只動現在壞掉的那一種情況。

**二、部位太小時照算，但把成本佔比寫出來，不設門檻。**
與流動性警示同一個做法（`stock-card.tsx` 該處註解：「門檻是經驗值、未經驗證，
因此只陳述事實比例」）。風報比本來就是扣費後的，成本高自然會把它壓下去，
既有的「風報比低於 1」警示會自己亮。

## 核心：成本必須以真實股數計算

`fees.ts` 目前每一個函式都以 1000 股為單位。零股**不能**用
`netRiskPerLot × shares / 1000` 縮放，因為 `MIN_BROKERAGE`（NT$20）是固定成本，
按比例縮放會系統性低估。

NT$1,000 的股票、停損 915.4，買 1 股的最壞虧損：

| 算法 | 結果 |
|---|---|
| 每張 ÷ 1000（90,076 ÷ 1000） | NT$ 90.08 |
| 真實 1 股 | NT$ 127.35（價差 84.6 ＋ 買 20 ＋ 賣 20 ＋ 稅 2.75） |

縮放低估 29%。低估成本正是這個專案在 `fees.ts` 開頭、
`DEFAULT_FEE_DISCOUNT = 1`、與「賠率被交易成本翻面」警示裡反覆在防的事。

低消在部位金額低於 `MIN_BROKERAGE / (BROKERAGE_RATE × discount)`
（無折扣時約 NT$14,035）以下開始綁住。以 NT$1,000 的股票為例：

| 股數 | 部位金額 | 來回成本 | 佔部位 |
|---|---|---|---|
| 222 | 222,000 | 1,299 | 0.585% |
| 14 | 14,000 | 82 | 0.586% |
| 5 | 5,000 | 55 | 1.10% |
| 1 | 1,000 | 43 | 4.30% |

## 架構

### `fees.ts`：以股數為單位，per-lot 變成薄包裝

新增三個函式：

```ts
export function buyOutlay(price: number, shares: number, discount?: number | null): number
export function sellProceeds(price: number, shares: number, discount?: number | null): number
export function netPnl(entry: number, exit: number, shares: number, discount?: number | null): number
```

現有的 `buyOutlayPerLot`／`sellProceedsPerLot`／`netPnlPerLot` 改成一行包裝：

```ts
export function buyOutlayPerLot(price: number, discount?: number | null): number {
  return buyOutlay(price, SHARES_PER_LOT, discount);
}
```

**`fees.test.ts` 一個字不改必須全綠。** 那是這次改動的回歸測試——
動到全站最敏感的金額模組時，既有測試是唯一能證明行為沒變的東西。

另新增一個知道低消的成本佔比函式：

```ts
/** 以進場價買進、同價賣出的來回成本佔部位金額的百分比 */
export function roundTripCostPctFor(price: number, shares: number, discount?: number | null): number
```

既有的 `roundTripCostPct(discount)` 不動——它算的是費率式的理論值（0.585%），
在整股金額下正確，且已被 `fees.test.ts` 的多條測試釘住。兩者的差別就是低消，
在零股才顯現。

`lotEconomics` 不動。它是 per-lot 的，畫面在整張路徑上仍然用它。

### 新檔 `lib/oddLot.ts`

```ts
export type OddLotPlan = {
  shares: number;
  /** 是哪一個上限決定了股數 */
  limitedBy: 'risk' | 'capital';
  /** 買進金額（不含手續費，與 planPosition 的 cost 一致） */
  cost: number;
  /** 停損出場的實際虧損（含兩趟手續費與證交稅） */
  risk: number;
  pctOfCapital: number;
  capitalCap: number;
  /** 來回成本佔部位金額的百分比 */
  costPct: number;
};

export function planOddLot(opts: {
  riskBudget: number;
  capital: number;
  entryPrice: number | null | undefined;
  stopLoss: number | null | undefined;
  maxPositionPct?: number;
  feeDiscount?: number | null;
}): OddLotPlan | null;
```

求「同時滿足兩個上限的最大股數」：

- **資金上限**：`shares × entryPrice ≤ capital × maxPositionPct`。
  與 `planPosition` 的 `byCapital` 一致，**不含買進手續費**。
- **風險上限**：`|netPnl(entry, stop, shares)| ≤ riskBudget`。

風險那一條因為低消是分段函數，不能直接除。但它對股數**單調遞增**
（多買一股，最壞虧損必不減少），所以在 `[0, 資金上限股數]` 上**二分搜尋**。
閉式解要分買賣兩邊各兩種、共四個象限，分支寫錯的方向恰好是低估。

**前置檢查 `stopLoss < entryPrice`，否則回 null。** `netPnl` 在停損高於進場價時
是正數（獲利），取絕對值後單調性仍成立但語意完全錯了，會算出一個看起來正常的
假股數。這種計畫本來就不該給部位建議。

`planPosition` 一行不改。

### `position.ts`：兩者互斥

`PositionView` 新增 `oddLot: OddLotPlan | null`，並保證
**只在 `position.lots === 0` 時非 null**。

型別上表達不出互斥性（判別聯集可以，但那要改寫 `stock-card.tsx` 裡五處
剛在上一輪審查修過、註解寫得很仔細的程式碼）。改用一條測試釘死：
`position.lots > 0` 時 `oddLot` 必為 null。

`planPositionFor` 需要新的輸入 `stopLoss`——它已經在 `PositionInput` 裡了。

## 畫面

四處，全在 `stock-card.tsx`。

**一、新手橫幅**（約 317 行）。現在 0 張時印「每張最壞會賠 NT$ 90,076」。
改成「照建議買 222 股，最壞會賠 NT$ 19,997」。金額用 `oddLot.risk`，
不是 `netRiskPerLot × shares / 1000`。

**二、主區塊標題**（約 554 行）。`建議張數 / 0 張` → `建議股數 / 222 股`；
投入金額用 `oddLot.cost`。`單張最大虧損`（約 588 行）在零股時改成
`這個部位最大虧損`，值取 `oddLot.risk`。

**三、0 張說明**（約 661 行）改寫成零股建議：保留「為什麼買不到整張」
（那是使用者理解自己設定的唯一線索），加上來回成本佔比，
刪掉「本工具尚未支援零股」那一句。

`planOddLot` 回 null 時（例如停損無效，或連 1 股都超過風險上限——
NT$1,000 的股票配上 NT$100 的風險上限就會如此）維持現在的 0 張說明。

**四、流動性警示**（約 636 行）對零股關閉。它的分母是 `avgVolume20`，
那是**整股市場**的成交量，拿來衡量零股掛單能不能成交是錯的尺。
改成一句陳述：零股是獨立撮合市場，成交機會低於整股。

## 不動的

- **後端**：零股是純前端計算。`RULE_VERSION`、`openapi.yaml`、快取鍵全部不動。
- **localStorage 快照**：`position` 從來沒進過快照，它由 settings + payload 當場算，
  舊快照天生相容。
- **`planPosition`**、**`lotEconomics`**、**`roundTripCostPct`**：一行不改。
- **價值與存股視圖**：`VIEW_CONFIG` 裡這兩個視圖沒有 `position_sizing`，
  也沒有交易計畫。零股只出現在新手／動能／波段。

## 降級

| 情況 | 行為 |
|---|---|
| 算得出整張（`lots > 0`） | 完全維持現狀，`oddLot` 為 null |
| 停損 ≥ 進場價 | `planOddLot` 回 null，維持現在的 0 張說明 |
| 連 1 股都超過風險上限 | 同上 |
| 資金上限算出 0 股（1 股就超過單檔上限） | 同上 |
| `economics` 為 null（缺停損或停利） | 整個區塊本來就不渲染，不受影響 |

## 測試

`oddLot.test.ts`（新檔）：

- **關鍵不變量：真的取到最大值。** `netLoss(shares) ≤ riskBudget` 且
  `netLoss(shares + 1) > riskBudget`。只測前者的話回傳 1 股也會通過。
- 資金上限也擋得住：`shares × entry ≤ capital × maxPositionPct`。
- 低消綁住的區間算得對：NT$1,000 的股票 1 股（停損 915.4），
  `risk` 是 127.35 不是縮放出來的 90.08。
- `stopLoss ≥ entryPrice` 回 null。
- `costPct`：1 股 NT$1,000 → 4.30%；222 股 → 0.585%。

`fees.test.ts`（既有，不改）：全綠即為回歸通過。
`fees.test.ts` 新增：`buyOutlay(p, 1000) === buyOutlayPerLot(p)`（包裝等價）、
低消在小股數綁住（`buyOutlay(1000, 5)` 的手續費是 20 不是 7.125）。

`position.test.ts`（既有）新增：`lots > 0` 時 `oddLot` 為 null（互斥）、
`lots === 0` 且計畫有效時 `oddLot` 非 null。

畫面沒有元件測試基礎建設（`environment: 'node'`，無 jsdom），
靠 typecheck 與 build 驗證，邏輯全部留在純函式裡。

## 驗收

- `pnpm test` 全綠且測試數增加；`fees.test.ts` 未修改
- `pnpm run typecheck` 乾淨、`pnpm run build` 成功
- 以 entry 1000／stop 915.4／預設設定手算，`planOddLot` 回 222 股、
  `risk` 19,997、`costPct` 0.585%
