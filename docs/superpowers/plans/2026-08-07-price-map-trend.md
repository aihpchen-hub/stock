# 價位地圖加上走勢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 `price-map` 在既有的價位刻度背後畫出收盤價走勢，回答「怎麼走到這裡的」。

**Architecture:** 後端切現有日線的最後 N 根收盤價（N 依分析週期）放進 payload；前端把軸範圍抽成共用 helper，讓價位刻度與走勢線用同一個 min/max；元件在既有容器內插一層 SVG，刻度與標籤程式碼完全不動。

**Tech Stack:** Express 5 / TypeScript / OpenAPI + Orval codegen / React 19 / Tailwind 4 / vitest（`environment: 'node'`，無 jsdom）

## Global Constraints

- 設計文件：`docs/superpowers/specs/2026-08-07-price-map-trend-design.md`
- 只給收盤價，不給 OHLC。理由見 spec「收盤價折線，不畫蠟燭」
- 根數 = `PERIOD_TRADING_DAYS[period]`（1m→20、3m→60、6m→120），重用既有常數
- 軸範圍必須涵蓋序列，**不得裁切 K 線** —— `price-map.tsx` 開頭「讓圖本身永遠不說謊」
- 線的顏色走台股慣例：漲用 `up`（紅）、跌用 `down`（綠）
- `buildPriceMap` 的簽章與回傳型別不變，既有 `priceMap.test.ts` 不得改動
- **不**遞增 `RULE_VERSION`（純新增顯示欄位，不改計算）；**要**遞增 `stockCacheKey` v7→v8
- 測試一律 TDD：先寫失敗測試、確認它因為功能不存在而失敗、再實作
- 註解寫「為什麼」，與這個 codebase 既有風格一致

---

### Task 1: 後端產出 priceSeries

**Files:**
- Modify: `artifacts/api-server/src/lib/indicators.ts`（新增 `buildPriceSeries`）
- Test: `artifacts/api-server/src/lib/indicators.test.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Modify: `artifacts/api-server/src/routes/stock.ts`
- Modify: `artifacts/api-server/src/lib/dailyCache.ts`（快取鍵 v7→v8）

**Interfaces:**
- Consumes: 既有的 `PriceRow`（`date` / `close` / `max` / `min` / `Trading_Volume`）與 `PERIOD_TRADING_DAYS`
- Produces: `buildPriceSeries(rows: PriceRow[], bars: number): PriceSeries | null`，
  `interface PriceSeries { from: string; closes: number[] }`

- [ ] **Step 1: 寫失敗測試**

加到 `artifacts/api-server/src/lib/indicators.test.ts` 末端：

```ts
describe("buildPriceSeries", () => {
  function dated(date: string, close: number): PriceRow {
    return { date, close, max: close, min: close, Trading_Volume: 1_000_000 };
  }

  it("取最後 N 根的收盤價，由舊到新", () => {
    const rows = [
      dated("2026-01-02", 10),
      dated("2026-01-03", 11),
      dated("2026-01-06", 12),
      dated("2026-01-07", 13),
    ];
    expect(buildPriceSeries(rows, 3)).toEqual({
      from: "2026-01-03",
      closes: [11, 12, 13],
    });
  });

  it("資料比要求的少時就給全部，不補值", () => {
    const rows = [dated("2026-01-02", 10), dated("2026-01-03", 11)];
    expect(buildPriceSeries(rows, 60)).toEqual({ from: "2026-01-02", closes: [10, 11] });
  });

  it("不足兩根時回 null —— 一個點構不成走勢", () => {
    expect(buildPriceSeries([dated("2026-01-02", 10)], 60)).toBeNull();
    expect(buildPriceSeries([], 60)).toBeNull();
  });

  it("略過收盤價無效的列，日期跟著對齊", () => {
    const rows = [
      dated("2026-01-02", 10),
      { date: "2026-01-03", close: Number.NaN, max: 1, min: 1, Trading_Volume: 0 },
      dated("2026-01-06", 12),
    ];
    expect(buildPriceSeries(rows, 60)).toEqual({ from: "2026-01-02", closes: [10, 12] });
  });

  it("真實資料：8111 取 60 根", () => {
    const s = buildPriceSeries(p8111, 60)!;
    expect(s.closes).toHaveLength(60);
    expect(s.closes[s.closes.length - 1]).toBe(p8111[p8111.length - 1]!.close);
  });
});
```

並把 `buildPriceSeries` 加進該檔頂端的 import 清單。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run artifacts/api-server/src/lib/indicators.test.ts`
Expected: FAIL — `buildPriceSeries is not a function`

- [ ] **Step 3: 實作**

加到 `artifacts/api-server/src/lib/indicators.ts`：

```ts
export interface PriceSeries {
  /** 最早一根的日期。沒有 x 軸的線必須說得出自己的區間 */
  from: string;
  /** 收盤價，由舊到新 */
  closes: number[];
}

/**
 * 價位地圖要畫的收盤價序列。
 *
 * 只給收盤價：地圖的繪圖區在手機上只有約 117px，60 根蠟燭每根 1.95px，
 * 畫出來是一片糊而不是 K 線。高低點資訊已由 swingHigh／swingLow 的刻度線提供。
 * 收盤價陣列也小得多 —— 實測 69 根只有 0.3 KB，塞進 localStorage 快照
 * 完全不成問題，因此歷史快照也保有走勢。
 *
 * 不足兩根時回 null：一個點構不成走勢。
 */
export function buildPriceSeries(rows: PriceRow[], bars: number): PriceSeries | null {
  const usable = rows.filter(
    (r) => typeof r.date === "string" && typeof r.close === "number" && Number.isFinite(r.close),
  );
  const slice = bars > 0 ? usable.slice(-bars) : usable;
  if (slice.length < 2) return null;
  return { from: slice[0]!.date, closes: slice.map((r) => r.close) };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run artifacts/api-server/src/lib/indicators.test.ts`
Expected: PASS

- [ ] **Step 5: 契約加欄位**

`lib/api-spec/openapi.yaml`，在 `StockDetailResult` 的 `properties` 內（放在 `swingLow` 之後）加：

```yaml
        priceSeries:
          oneOf:
            - $ref: "#/components/schemas/PriceSeries"
            - type: "null"
          description: >-
            價位地圖用的收盤價序列。資料不足時為 null，地圖退回純刻度。
```

並在 `components/schemas` 加（放在 `Returns` 之前）：

```yaml
    PriceSeries:
      type: object
      description: >-
        只給收盤價。價位地圖的繪圖區在手機上約 117px，60 根蠟燭每根 1.95px，
        畫出來是一片糊而不是 K 線；折線在任何密度下都誠實可讀，
        而高低點資訊已由 swingHigh／swingLow 的刻度線提供。
      properties:
        from:
          type: string
          description: 最早一根的日期（YYYY-MM-DD）
        closes:
          type: array
          items:
            type: number
          description: 由舊到新。長度依分析週期：1m→20、3m→60、6m→120 個交易日。
      required: [from, closes]
```

- [ ] **Step 6: 重新產生型別**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: 成功，且 `lib/api-client-react/src/generated/api.schemas.ts` 出現 `priceSeries`

- [ ] **Step 7: 路由回傳該欄位**

`artifacts/api-server/src/routes/stock.ts`：

import 加 `buildPriceSeries`；在 `const volume = calcVolumeProfile(prices);` 之後加：

```ts
    // 價位地圖的走勢線。prices 本來就抓了 240 個日曆日（≈163 根），
    // 切最後 N 根即可 —— 零額外請求。N 跟著分析週期，
    // 「這張圖的尺度與你選的持有期一致」本身就可以解釋。
    const priceSeries = buildPriceSeries(prices, PERIOD_TRADING_DAYS[period] ?? 60);
```

payload 內（`avgVolume20` 那一行之後）加 `priceSeries,`。

- [ ] **Step 8: 遞增快取鍵**

`artifacts/api-server/src/lib/dailyCache.ts`：`stock|v7|` 改為 `stock|v8|`。
**不**動 `RULE_VERSION` —— 這是純新增的顯示欄位，不改變任何既有計算，
前瞻驗證不該因此把快照分成兩組。

- [ ] **Step 9: 全量驗證並提交**

```bash
pnpm run typecheck && npx vitest run
git add -A
git commit -m "後端產出價位地圖要畫的收盤價序列"
```

---

### Task 2: buildTrend 純函式

**Files:**
- Modify: `artifacts/web/src/lib/priceMap.ts`
- Test: `artifacts/web/src/lib/priceMap.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PriceSeries`（前端由 `@workspace/api-client-react` 取得同形狀的型別）
- Produces:
  ```ts
  function axisRange(input: PriceMapInput): { min: number; max: number } | null  // 私有
  export interface Trend {
    points: string;      // SVG polyline，座標系 0~100 × 0~100
    areaPath: string;    // 面積填色的封閉路徑
    direction: 'up' | 'down' | 'flat';
    from: string;
    bars: number;
  }
  export function buildTrend(input: PriceMapInput): Trend | null
  ```
  `PriceMapInput` 新增 optional 欄位 `priceSeries?: { from: string; closes: number[] } | null`

- [ ] **Step 1: 寫失敗測試**

加到 `artifacts/web/src/lib/priceMap.test.ts` 末端（`buildTrend` 與 `buildPriceMap` 加進 import）：

```ts
describe('buildTrend', () => {
  const base = {
    planKind: 'immediate' as const,
    currentPrice: 100,
    entryLow: 98,
    entryHigh: 100,
    stopLoss: 92,
    takeProfit: 115,
  };

  it('沒有序列時回 null', () => {
    expect(buildTrend(base)).toBeNull();
    expect(buildTrend({ ...base, priceSeries: null })).toBeNull();
  });

  it('只有一個點時回 null —— 一個點構不成走勢', () => {
    expect(buildTrend({ ...base, priceSeries: { from: '2026-05-08', closes: [100] } })).toBeNull();
  });

  it('點數等於收盤價數，首尾 x 為 0 與 100', () => {
    const t = buildTrend({
      ...base,
      priceSeries: { from: '2026-05-08', closes: [95, 100, 105] },
    })!;
    const pts = t.points.split(' ').map((p) => p.split(',').map(Number));
    expect(pts).toHaveLength(3);
    expect(pts[0]![0]).toBeCloseTo(0, 5);
    expect(pts[2]![0]).toBeCloseTo(100, 5);
    expect(t.bars).toBe(3);
    expect(t.from).toBe('2026-05-08');
  });

  it('方向由首尾比較決定，走台股慣例', () => {
    const up = buildTrend({ ...base, priceSeries: { from: 'x', closes: [90, 110] } })!;
    const down = buildTrend({ ...base, priceSeries: { from: 'x', closes: [110, 90] } })!;
    const flat = buildTrend({ ...base, priceSeries: { from: 'x', closes: [100, 100] } })!;
    expect(up.direction).toBe('up');
    expect(down.direction).toBe('down');
    expect(flat.direction).toBe('flat');
  });

  it('走勢線與價位刻度共用同一個軸 —— 等於月線的收盤價，其 y 必須等於月線刻度', () => {
    // 這是整個功能的正確性核心：兩者對不起來的話，圖會指著錯的位置
    const input = { ...base, ma20: 104, priceSeries: { from: 'x', closes: [92, 104, 115] } };
    const levels = buildPriceMap(input);
    const ma20 = levels.find((l) => l.key === 'ma20')!;
    const t = buildTrend(input)!;
    const secondY = Number(t.points.split(' ')[1]!.split(',')[1]);
    // pct 由下往上、SVG y 由上往下，因此互補
    expect(100 - secondY).toBeCloseTo(ma20.pct, 5);
  });

  it('序列超出價位範圍時，價位刻度仍落在 0~100 內（軸有涵蓋序列，K 線不被裁切）', () => {
    const input = { ...base, priceSeries: { from: 'x', closes: [40, 200] } };
    for (const level of buildPriceMap(input)) {
      expect(level.pct).toBeGreaterThanOrEqual(0);
      expect(level.pct).toBeLessThanOrEqual(100);
    }
  });

  it('序列完全在價位範圍內時不無故放大軸', () => {
    const without = buildPriceMap(base);
    const withSeries = buildPriceMap({
      ...base,
      priceSeries: { from: 'x', closes: [95, 100, 105] },
    });
    expect(withSeries.map((l) => l.pct)).toEqual(without.map((l) => l.pct));
  });

  it('全部同值（一價到底）不產生 NaN', () => {
    const t = buildTrend({ ...base, priceSeries: { from: 'x', closes: [100, 100, 100] } })!;
    expect(t.points).not.toContain('NaN');
    expect(t.areaPath).not.toContain('NaN');
  });

  it('非有限值的序列回 null', () => {
    expect(
      buildTrend({ ...base, priceSeries: { from: 'x', closes: [100, Number.NaN] } }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run artifacts/web/src/lib/priceMap.test.ts`
Expected: FAIL — `buildTrend is not a function`

- [ ] **Step 3: 抽出 axisRange 並讓 buildPriceMap 改用它**

`artifacts/web/src/lib/priceMap.ts`。先在 `PriceMapInput` 加欄位：

```ts
  /**
   * 收盤價序列。有值時軸範圍必須涵蓋它 —— 否則超出範圍的收盤價會被裁掉，
   * 那是一張說謊的圖。
   */
  priceSeries?: { from: string; closes: number[] } | null;
```

新增私有 helper（放在 `buildPriceMap` 之前）：

```ts
/** 這張圖上所有要畫的價位 */
function pickedLevels(input: PriceMapInput): Array<[PriceMapKey, number]> {
  const showPlan = input.planKind !== 'none';
  const candidates: Array<[PriceMapKey, number | null | undefined]> = [
    ['take_profit', input.takeProfit],
    ['swing_high', input.swingHigh],
    ['first_target', input.firstTarget],
    ['entry_high', input.entryHigh],
    ['entry_low', input.entryLow],
    ['current', input.currentPrice],
    ['ma20', input.ma20],
    ['ma60', input.ma60],
    ['stop_loss', input.stopLoss],
    ['trailing_stop', input.trailingStop],
    ['swing_low', input.swingLow],
  ];
  return candidates
    .filter(([key]) => showPlan || !PLAN_KEYS.has(key))
    .filter((entry): entry is [PriceMapKey, number] => Number.isFinite(entry[1]))
    .sort((a, b) => a[1] - b[1]);
}

/** 序列裡可用的收盤價。任一非有限值即視為整段不可用 */
function usableCloses(input: PriceMapInput): number[] | null {
  const closes = input.priceSeries?.closes;
  if (!closes || closes.length < 2) return null;
  return closes.every((c) => Number.isFinite(c)) ? closes : null;
}

/**
 * 軸的上下界，由價位與收盤價序列**共同**決定。
 *
 * 兩個對外函式都呼叫它，因此走勢線與價位刻度不可能對不起來 ——
 * 那比不畫還糟：一條指著錯位置的線看起來仍然像是真的。
 */
function axisRange(input: PriceMapInput): { min: number; max: number } | null {
  const values = pickedLevels(input).map(([, v]) => v);
  const closes = usableCloses(input);
  if (closes) values.push(...closes);
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** 價格 → 0~100 的軸位置（由下往上），與 AXIS_PADDING 一致 */
function toPct(value: number, axis: { min: number; max: number }): number {
  const span = axis.max - axis.min;
  // 全部同值時除數為零 —— 放中間，不製造 NaN
  if (span === 0) return 50;
  return AXIS_PADDING + ((value - axis.min) / span) * (100 - AXIS_PADDING * 2);
}
```

再把 `buildPriceMap` 內部改用它們（第 168~184 行那一段）：

```ts
export function buildPriceMap(input: PriceMapInput): PriceMapLevel[] {
  const picked = pickedLevels(input);
  if (picked.length === 0) return [];

  const axis = axisRange(input)!;
  const current = Number.isFinite(input.currentPrice) ? (input.currentPrice as number) : null;

  const levels: PriceMapLevel[] = picked.map(([key, value]) => {
    const pct = toPct(value, axis);
    return {
      key,
      label: (input.glossary === 'plain' ? PLAIN_LABELS[key] : undefined) ?? LABELS[key],
      emphasis: CONTEXT_KEYS.has(key) ? 'context' : 'primary',
      value,
      pct,
      labelPct: pct,
      fromCurrent:
        current == null || current === 0 || key === 'current'
          ? null
          : ((value - current) / current) * 100,
    };
  });

  return spreadLabels(levels);
}
```

- [ ] **Step 4: 實作 buildTrend**

```ts
export interface Trend {
  /** SVG polyline 的 points，座標系 0~100 × 0~100（y 由上往下，與 SVG 一致） */
  points: string;
  /** 面積填色用的封閉路徑 */
  areaPath: string;
  /** 首尾比較。線的顏色走台股慣例：漲紅跌綠 */
  direction: 'up' | 'down' | 'flat';
  /** 最早一根的日期。沒有 x 軸的線必須說得出自己的區間 */
  from: string;
  bars: number;
}

/**
 * 價位地圖背後的收盤價走勢。
 *
 * 同樣是現價 104、月線 106，一路陰跌下來與剛從 90 拉上來是完全不同的處境，
 * 而純刻度的地圖上這兩者長得一模一樣。
 *
 * y 用的是與價位刻度同一個 axisRange —— 那是這個函式唯一真正重要的性質。
 */
export function buildTrend(input: PriceMapInput): Trend | null {
  const closes = usableCloses(input);
  if (!closes) return null;
  const axis = axisRange(input);
  if (!axis) return null;

  const lastX = closes.length - 1;
  const coords = closes.map((close, i) => {
    const x = (i / lastX) * 100;
    // pct 由下往上，SVG 的 y 由上往下
    const y = 100 - toPct(close, axis);
    return [x, y] as const;
  });

  const points = coords.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
  const areaPath = `M ${round(coords[0]![0])},100 ${coords
    .map(([x, y]) => `L ${round(x)},${round(y)}`)
    .join(' ')} L ${round(coords[lastX]![0])},100 Z`;

  const first = closes[0]!;
  const last = closes[lastX]!;
  const direction = last > first ? 'up' : last < first ? 'down' : 'flat';

  return { points, areaPath, direction, from: input.priceSeries!.from, bars: closes.length };
}

/** SVG 座標留兩位小數就夠，避免序列長時字串無謂變大 */
const round = (n: number) => Math.round(n * 100) / 100;
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run artifacts/web/src/lib/priceMap.test.ts`
Expected: PASS，且既有的 `buildPriceMap` 測試全數維持通過

- [ ] **Step 6: 提交**

```bash
pnpm run typecheck && npx vitest run
git add -A
git commit -m "價位地圖的軸範圍改由價位與收盤價序列共同決定"
```

---

### Task 3: 元件畫出走勢

**Files:**
- Modify: `artifacts/web/src/components/stock/price-map.tsx`
- Modify: `artifacts/web/src/components/stock-card.tsx`（把 `priceSeries` 傳進去）

**Interfaces:**
- Consumes: Task 2 的 `buildTrend(input): Trend | null`
- Produces: 無新介面

- [ ] **Step 1: 元件渲染走勢**

`price-map.tsx`：import 加 `buildTrend`，函式內加 `const trend = buildTrend(input);`。

在 `<div className="relative h-[300px]">` 內、**進場區色帶之前**插入（DOM 順序在前 = 畫在最底層）：

```tsx
          {/* 走勢線畫在最底層，刻度與標籤蓋在它上面。
              preserveAspectRatio="none" 讓 viewBox 直接對應容器；
              non-scaling-stroke 避免線寬被非等比縮放拉扁。
              aria-hidden 是因為所有數值在右側標籤欄都有文字版本。 */}
          {trend && (
            <svg
              className="absolute inset-y-0 left-0 w-[42%]"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d={trend.areaPath}
                className={
                  trend.direction === 'down'
                    ? 'fill-down/10'
                    : trend.direction === 'up'
                      ? 'fill-up/10'
                      : 'fill-muted-foreground/10'
                }
              />
              <polyline
                points={trend.points}
                fill="none"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                className={
                  trend.direction === 'down'
                    ? 'stroke-down'
                    : trend.direction === 'up'
                      ? 'stroke-up'
                      : 'stroke-muted-foreground'
                }
              />
            </svg>
          )}
```

- [ ] **Step 2: 標題列說出區間**

沒有 x 軸的線必須說得出自己畫的是多久。把右上角那個標記改成：

```tsx
        {pending ? (
          <span className="text-[10px] text-amber-500 font-medium">計畫尚未成立</span>
        ) : (
          <span className="text-[10px] text-muted-foreground/70">
            {trend ? `近 ${trend.bars} 個交易日 · 依真實比例` : '依真實比例'}
          </span>
        )}
```

- [ ] **Step 3: 卡片把序列傳進去**

`stock-card.tsx`：`priceSeries` 加進解構清單（`degraded,` 那一行附近），並在 `<PriceMap ... />` 的 props 加 `priceSeries={priceSeries}`。

- [ ] **Step 4: typecheck 與測試**

Run: `pnpm run typecheck && npx vitest run`
Expected: 全數通過

- [ ] **Step 5: 建置並實跑驗證**

```bash
pnpm run build
PORT=5099 node --enable-source-maps artifacts/api-server/dist/index.mjs &
sleep 4
curl -s "http://localhost:5099/api/healthz" -o /dev/null -w "%{http_code}\n"
kill %1
```

Expected: healthz 200、build 成功。
（`/api/stock/2330` 需要對外網路與 FinMind，本機不強制驗證。）

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "價位地圖畫出收盤價走勢"
```

---

## Self-Review

**Spec coverage**

| Spec 段落 | 對應 |
|---|---|
| 契約新增 `priceSeries` | Task 1 Step 5~6 |
| 後端切最後 N 根、零額外請求 | Task 1 Step 3、Step 7 |
| 不動 `RULE_VERSION`、快取鍵 v7→v8 | Task 1 Step 8 |
| 軸範圍改由價位∪序列共同決定 | Task 2 Step 3（`axisRange`） |
| `buildPriceMap` 簽章不變 | Task 2 Step 3，既有測試不動 |
| 元件插 SVG、刻度標籤不動 | Task 3 Step 1 |
| 圖下方說出區間 | Task 3 Step 2（改在標題列，比圖下方更靠近圖本身） |
| 不做 tooltip／量能／蠟燭／縮放 | 全計畫未出現 |
| 視圖沿用 `shows('price_map')` | 無需改動，`PriceMap` 的呼叫點本來就在該開關內 |
| 降級：null／舊快照／單點／一價到底 | Task 2 Step 1 的測試涵蓋四種 |
| 測試清單 6 項 | Task 2 Step 1 涵蓋全部，另加「不無故放大軸」與「非有限值」 |

**Placeholder scan**：無 TBD／TODO，每個 code step 都有可直接貼上的完整程式碼。

**Type consistency**：`PriceSeries { from, closes }` 在 Task 1（後端）與 Task 2（`PriceMapInput.priceSeries`）形狀一致；`Trend` 的欄位名 `points` / `areaPath` / `direction` / `from` / `bars` 在 Task 2 定義、Task 3 使用，逐一對照無誤；`buildTrend(input)` 單一參數，與 spec 修正後的簽章一致。
