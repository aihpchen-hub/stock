# 價位地圖加上走勢

**日期**：2026-08-07
**範圍**：子專案 1（共兩個）。子專案 2 是資料層重整（批次端點 + payload 分層），另開一份。

## 問題

畫面上一張圖都沒有。`components/ui/chart.tsx`（366 行的 recharts 封裝）在專案裡，但沒有任何頁面 import 它。

`price-map.tsx` 已經把交易計畫的價位、均線與近 20 日高低畫在同一根真實比例的軸上，回答了「進場區壓在月線之上還是之下」「現價離停損還有多遠」。它沒有回答的是**「怎麼走到這裡的」**——同樣是現價 104、月線 106，一路陰跌下來與剛從 90 拉上來是完全不同的處境，而畫面上這兩者長得一模一樣。

## 決策與理由

### 升級 price-map，不新增第二張圖

兩者畫的是同一組價位、同一個 y 軸。並存等於在同一張卡片上放兩個價格軸講同一件事——那正是這個 codebase 一路在消除的東西（`stock-card.tsx:450` 附近的註解記載過「一張卡片講三次」而刪掉重複價位）。

### 收盤價折線，不畫蠟燭

繪圖區是 `w-[42%]`。實測版面：

| 螢幕 | 繪圖區寬度 | 60 根的每根寬度 |
|---|---|---|
| 手機 375px | ~117px | 1.95px |
| 桌機（`md:grid-cols-2`） | ~183px | 3.0px |

蠟燭至少要 3px（1px 實體 + 影線）才看得出上下影線。手機上的 1.95px 畫出來是一片糊；6m 的 120 根是 1px。**畫不誠實就不畫**——這與 `price-map.tsx` 開頭「讓圖本身永遠不說謊」是同一個原則。

高低點資訊沒有因此消失：`swingHigh` / `swingLow` 的刻度線本來就在圖上。

折線還解掉一個原本以為存在的問題。實測（用專案自己的 `__fixtures__/prices.json`，69 根真實日線）：

| 格式 | 69 根 | 換算 60 根 × 5 檔 × 50 筆快照 |
|---|---|---|
| 完整 OHLC 物件 | 5.5 KB | ~3.25 MB（**超過 localStorage 5 MB 預算**） |
| 精簡 `[日,高,低,收]` | 1.7 KB | ~1 MB |
| **只有收盤價** | **0.3 KB** | **~65 KB** |

只存收盤價的話快照成本可以忽略，因此**不需要「序列不進快照」這條特例**，歷史快照也保有走勢圖。

### 根數跟著分析週期

1m→20、3m→60、6m→120 個交易日，直接重用既有的 `PERIOD_TRADING_DAYS`。

「這張圖的尺度與你選的持有期一致」本身就可以解釋，不需要另一組控制元件——而報告已經指出卡片太長，不該再加。

### 軸範圍改由「價位 ∪ 序列」共同決定

**這是本次最關鍵的一處。** `buildPriceMap` 目前只由價位決定上下界。軸不涵蓋序列的話，超出範圍的收盤價會被裁掉——一張說謊的圖。

代價是既有的價位刻度會比現在擠：60 根的價格區間通常比計畫價位的跨度大，實測估計壓縮約 2 倍。這是換到走勢資訊必須付的，且已與使用者確認。

## 實作

### 契約（`lib/api-spec/openapi.yaml`）

`StockDetailResult` 新增：

```yaml
priceSeries:
  oneOf:
    - $ref: "#/components/schemas/PriceSeries"
    - type: "null"
  description: >-
    收盤價序列，供價位地圖畫出走勢。資料不足時為 null，地圖退回純刻度。

PriceSeries:
  type: object
  description: >-
    只給收盤價。價位地圖的繪圖區在手機上約 117px，60 根蠟燭每根 1.95px，
    畫出來是一片糊而不是 K 線；折線在任何密度下都誠實可讀，
    而高低點資訊已由 swingHigh／swingLow 的刻度線提供。
  properties:
    from:
      type: string
      description: 最早一根的日期（YYYY-MM-DD）。沒有 x 軸的線必須說得出自己的區間。
    closes:
      type: array
      items: { type: number }
      description: 由舊到新。長度依分析週期：1m→20、3m→60、6m→120 個交易日。
  required: [from, closes]
```

改完跑 `pnpm --filter @workspace/api-spec run codegen`。

### 後端（`artifacts/api-server/src/routes/stock.ts`）

`prices` 已經抓回 240 個日曆日（≈163 根），切最後 N 根即可，**零額外請求**。

N 來自 `PERIOD_TRADING_DAYS[period]`。序列長度不足 2 時回 `null`——一個點構不成走勢。

不遞增 `RULE_VERSION`：這是純新增的顯示欄位，不改變任何既有計算。但 `stockCacheKey` 的版本前綴要動（v7→v8），否則部署當天稍早寫入的快取缺這個欄位，畫面會有半天看不到走勢。

### 純函式（`artifacts/web/src/lib/priceMap.ts`）

軸範圍目前是 `buildPriceMap` 內部算的，沒有對外。走勢線必須用**同一個**軸，否則線與刻度會對不起來——那比不畫還糟。

做法是把軸範圍抽成一個共用的私有 helper，兩個對外函式各自呼叫它：

```ts
/** 價位與序列共同決定的上下界。兩個對外函式都用它，因此不可能不一致 */
function axisRange(input: PriceMapInput): { min: number; max: number } | null;

export function buildPriceMap(input: PriceMapInput): PriceMapLevel[];   // 簽章不變

export interface Trend {
  /** SVG polyline 的 points 字串，座標系 0~100 × 0~100 */
  points: string;
  /** 面積填色用的封閉路徑 */
  areaPath: string;
  /** 首尾比較。線的顏色走台股慣例：漲紅跌綠 */
  direction: 'up' | 'down' | 'flat';
  from: string;
  bars: number;
}

export function buildTrend(input: PriceMapInput): Trend | null;
```

`buildPriceMap` 的簽章與回傳型別**不變**，既有的 `priceMap.test.ts` 不受影響——`PriceMapInput` 只是多一個 optional 的 `priceSeries`。

元件端因此是 `const levels = buildPriceMap(input); const trend = buildTrend(input);`。

### 元件（`artifacts/web/src/components/stock/price-map.tsx`）

在既有的 `relative h-[300px]` 內、**刻度線之前**插入：

```tsx
{trend && (
  <svg
    className="absolute left-0 w-[42%] h-full overflow-visible"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path d={trend.areaPath} className={trend.direction === 'down' ? 'fill-down/10' : 'fill-up/10'} />
    <polyline
      points={trend.points}
      fill="none"
      vectorEffect="non-scaling-stroke"
      strokeWidth={1.5}
      className={trend.direction === 'down' ? 'stroke-down' : 'stroke-up'}
    />
  </svg>
)}
```

`preserveAspectRatio="none"` 讓 viewBox 直接對應容器；`vectorEffect="non-scaling-stroke"` 避免線寬被非等比縮放拉扁。`aria-hidden` 是因為所有數值在右側標籤欄都有文字版本。

刻度線與標籤的程式碼**完全不動**。

圖下方那行說明改成帶區間：

```
近 60 個交易日（2026-05-08 起）· 依真實比例
```

### 不做

游標探針／tooltip（117px 寬的元素上做觸控互動會與頁面捲動打架，而每個價位的數字在標籤欄本來就有）、量能副圖、蠟燭、縮放平移、x 軸刻度。

### 視圖

沿用既有的 `shows('price_map')` 開關——`newbie`／`momentum`／`swing` 有，`value`／`dividend` 沒有。不新增設定。

## 降級與相容

| 情況 | 行為 |
|---|---|
| `priceSeries` 為 null（新股、資料不足、FinMind 失敗） | 不渲染 svg，地圖退回現狀 |
| 舊快照沒有這個欄位 | 同上。與 `chips`／`advice` 既有的向後相容路徑一致 |
| 序列只有 1 個點 | `buildTrend` 回 null |
| 序列全部同值（一價到底） | `direction: 'flat'`，畫一條水平線，用中性色 |

## 測試

`artifacts/web/src/lib/priceMap.test.ts` 補：

1. 軸範圍涵蓋序列的最高與最低——序列超出價位範圍時，價位的 `pct` 仍落在 0~100 內
2. 序列完全在價位範圍內時，軸範圍不變（不無故放大）
3. 空序列、單點序列、非有限值回 `null`
4. `direction` 三種判定（漲／跌／平）
5. `points` 的第一個 x 是 0、最後一個是 100，且點數等於 `closes.length`
6. y 座標與同一個軸上的價位刻度用同一組 `min`/`max`——給定一個等於 `ma20` 的收盤價，其 y 必須等於 `ma20` 刻度的 `pct`

後端 `stock.ts` 的切片邏輯若抽成純函式（`sliceSeries(prices, bars)`）則一併測；否則由既有的路由測試涵蓋。

純函式，不需要元件測試基礎建設（專案是 `environment: 'node'`，沒有 jsdom）。

## 驗收

- `pnpm test` 全綠且測試數增加
- `pnpm run typecheck` 乾淨
- `pnpm run build` 成功
- 建置產物實跑：`/api/stock/2330` 回傳含 `priceSeries`，長度等於該週期的交易日數
