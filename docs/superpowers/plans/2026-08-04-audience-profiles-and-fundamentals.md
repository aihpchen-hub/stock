# 受眾分流與財報資料 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓五種投資人各自只看到自己需要的東西 —— 並補上價值投資與存股族從來就沒有的估值、股利與財報品質資料。

**Architecture:** 受眾是**純前端 view config**（`lib/view-profile`），不經模型也不經 API：`hide_sections` 是 `user_profile` 的查表結果，交給模型等於用 16~20 秒延遲換一個常數，而 `net_risk_reward` 依賴只存在瀏覽器的券商折扣、模型算不出來。資料層分兩批：`TaiwanStockPER`／`TaiwanStockDividend`／`TaiwanStockDividendResult` 格式扁平，併入主流程；財報三表是**長格式**（`type`／`value` 一列一科目）需要 pivot，且季頻更新慢，走**獨立端點延後載入**，避開首次查詢的 FinMind 請求數尖峰。

**Tech Stack:** TypeScript 5.9、React 19、Vitest 4、Express 5、FinMind、OpenAPI + Orval

## Global Constraints

- **直接在 `main` 上工作**。
- **不動 `RULE_VERSION`（3）。** 本計畫不改任何評分規則或交易計畫價位。
- **必須遞增 `stockCacheKey` 版本前綴**（目前 `v5` → `v6`），理由同 Plan 2。
- **契約先改 `openapi.yaml`** 再 `codegen`。
- **股利年度一律用 `date` 的西元年**，不可用 `year` 欄位 —— 它是民國格式（`"93年"`），排序會錯。
- **連續配息年數從最新年度往回數到斷層為止。** 實測 2412 中華電 2009 年缺席，直接算總年數會得到 21 年，正確答案是 17 年。
- **財報資料不進 localStorage 快照。** 它季頻更新、可重抓，塞進快照只會撐大既有的 50 筆上限。
- 每個 Task 跑 `npx vitest run` 與 `npx pnpm run typecheck`，**用退出碼判斷**（不要接 `| tail`，管線會吃掉退出碼）。

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `artifacts/api-server/src/lib/valuation.ts` | PER／PBR／殖利率的百分位與區間 | 建立 |
| `artifacts/api-server/src/lib/valuation.test.ts` | 同上測試 | 建立 |
| `artifacts/api-server/src/lib/dividend.ts` | 連續配息年數、填息統計 | 建立 |
| `artifacts/api-server/src/lib/dividend.test.ts` | 同上測試 | 建立 |
| `artifacts/api-server/src/lib/financials.ts` | 財報三表長格式 pivot 與比率 | 建立 |
| `artifacts/api-server/src/lib/financials.test.ts` | 同上測試 | 建立 |
| `artifacts/api-server/src/routes/stock.ts` | 主流程加 PER／股利 | 修改 |
| `artifacts/api-server/src/routes/fundamentals.ts` | 財報三表延後載入端點 | 建立 |
| `artifacts/api-server/src/routes/index.ts` | 掛新路由 | 修改 |
| `artifacts/api-server/src/lib/dailyCache.ts` | v5→v6、`fundamentalsCacheKey` | 修改 |
| `lib/api-spec/openapi.yaml` | 新 schema 與端點 | 修改 |
| `lib/view-profile/*` | 受眾視圖設定純函式套件 | 建立 |
| `artifacts/web/src/components/profile-switcher.tsx` | 受眾切換器 | 建立 |
| `artifacts/web/src/components/stock/valuation-panel.tsx` | 估值與股利面板 | 建立 |
| `artifacts/web/src/components/stock-card.tsx` | 依 view config 決定顯示 | 修改 |
| `artifacts/web/src/pages/analysis.tsx` | 受眾狀態與傳遞 | 修改 |

---

### Task 1: 估值百分位

**Files:** Create `artifacts/api-server/src/lib/valuation.ts`、`valuation.test.ts`

**Interfaces:**
- Produces:
  - `interface MetricBand { current: number | null; percentile: number | null; low: number | null; median: number | null; high: number | null; samples: number }`
  - `buildBand(values: number[]): MetricBand`
  - `interface Valuation { per: MetricBand; pbr: MetricBand; dividendYield: MetricBand; asOf: string | null }`
  - `buildValuation(rows: PerRow[]): Valuation`
  - `interface PerRow { date: string; PER: number | null; PBR: number | null; dividend_yield: number | null }`

- [ ] **Step 1: 測試**

```ts
import { describe, expect, it } from "vitest";
import { buildBand, buildValuation, type PerRow } from "./valuation";

describe("buildBand", () => {
  it("百分位是「目前值高於歷史的幾成」—— 用來回答現在算貴還是便宜", () => {
    const b = buildBand([10, 20, 30, 40, 50]);
    expect(b.current).toBe(50);
    expect(b.percentile).toBe(80); // 5 個裡有 4 個比它低
  });

  it("最低點時百分位為 0", () => {
    expect(buildBand([50, 40, 30, 20, 10]).percentile).toBe(0);
  });

  it("回報區間端點與中位數，只給百分位看不出貴多少", () => {
    const b = buildBand([10, 20, 30, 40, 50]);
    expect(b.low).toBe(10);
    expect(b.high).toBe(50);
    expect(b.median).toBe(30);
  });

  it("偶數筆時中位數取中間兩筆平均", () => {
    expect(buildBand([10, 20, 30, 40]).median).toBe(25);
  });

  it("濾掉 null 與非有限值 —— 虧損公司沒有本益比，那是缺值不是零", () => {
    const b = buildBand([10, Number.NaN, 20, Number.POSITIVE_INFINITY, 30]);
    expect(b.samples).toBe(3);
    expect(b.current).toBe(30);
  });

  it("負值也濾掉 —— 本益比為負代表虧損，放進區間會把百分位算歪", () => {
    expect(buildBand([-5, 10, 20]).samples).toBe(2);
  });

  it("完全沒有可用樣本時全部為 null，不以 0 假裝有結論", () => {
    const b = buildBand([]);
    expect(b.current).toBeNull();
    expect(b.percentile).toBeNull();
    expect(b.samples).toBe(0);
  });

  it("只有一筆樣本時百分位為 null —— 一個點構不成區間", () => {
    const b = buildBand([25]);
    expect(b.current).toBe(25);
    expect(b.percentile).toBeNull();
    expect(b.samples).toBe(1);
  });
});

describe("buildValuation", () => {
  const rows: PerRow[] = [
    { date: "2026-08-01", PER: 20, PBR: 3, dividend_yield: 2 },
    { date: "2026-08-02", PER: 25, PBR: 4, dividend_yield: 1.5 },
    { date: "2026-08-03", PER: 30, PBR: 5, dividend_yield: 1 },
  ];

  it("三個指標各自成帶，current 取最後一筆", () => {
    const v = buildValuation(rows);
    expect(v.per.current).toBe(30);
    expect(v.pbr.current).toBe(5);
    expect(v.dividendYield.current).toBe(1);
  });

  it("asOf 取最後一筆日期", () => {
    expect(buildValuation(rows).asOf).toBe("2026-08-03");
  });

  it("空輸入不崩潰", () => {
    const v = buildValuation([]);
    expect(v.asOf).toBeNull();
    expect(v.per.samples).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**（`npx vitest run artifacts/api-server/src/lib/valuation.test.ts`）

- [ ] **Step 3: 實作**

```ts
/**
 * 估值區間與百分位。
 *
 * 只給「目前本益比 26.6」回答不了價值投資人真正要問的事：這個數字在它
 * 自己的歷史裡算高還是低。百分位把它放回五年區間裡 —— 第 80 百分位代表
 * 過去五年有八成的時間比現在便宜。
 *
 * 純計算，可獨立測試。這些數值只做顯示，不進評分。
 */

export interface PerRow {
  date: string;
  PER: number | null;
  PBR: number | null;
  dividend_yield: number | null;
}

export interface MetricBand {
  current: number | null;
  /** 目前值高於歷史樣本的百分比（0~100）。樣本少於 2 筆時為 null */
  percentile: number | null;
  low: number | null;
  median: number | null;
  high: number | null;
  /** 實際參與計算的樣本數，讓畫面能標明「五年 1,461 個交易日」 */
  samples: number;
}

const EMPTY_BAND: MetricBand = {
  current: null,
  percentile: null,
  low: null,
  median: null,
  high: null,
  samples: 0,
};

/**
 * 濾掉不能用的樣本。
 *
 * 負值與非有限值一律排除：本益比為負代表公司虧損，那是「沒有本益比」
 * 而不是「本益比很低」，混進區間會把百分位整個算歪。
 */
function usable(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
}

export function buildBand(values: Array<number | null | undefined>): MetricBand {
  const clean = usable(values);
  if (clean.length === 0) return { ...EMPTY_BAND };

  const current = clean[clean.length - 1]!;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  // 一個點構不成區間 —— 回 null 而非 0 或 100，那兩個值都會被誤讀成結論
  const percentile =
    clean.length < 2
      ? null
      : Math.round((sorted.filter((v) => v < current).length / (sorted.length - 1)) * 1000) / 10;

  return {
    current,
    percentile,
    low: sorted[0]!,
    median: Math.round(median * 100) / 100,
    high: sorted[sorted.length - 1]!,
    samples: clean.length,
  };
}

export interface Valuation {
  per: MetricBand;
  pbr: MetricBand;
  dividendYield: MetricBand;
  asOf: string | null;
}

export function buildValuation(rows: PerRow[]): Valuation {
  return {
    per: buildBand(rows.map((r) => r.PER)),
    pbr: buildBand(rows.map((r) => r.PBR)),
    dividendYield: buildBand(rows.map((r) => r.dividend_yield)),
    asOf: rows[rows.length - 1]?.date ?? null,
  };
}
```

- [ ] **Step 4: 測試通過、typecheck、提交**

```bash
npx vitest run artifacts/api-server/src/lib/valuation.test.ts
npx pnpm run typecheck
git add artifacts/api-server/src/lib/valuation.ts artifacts/api-server/src/lib/valuation.test.ts
git commit -m "估值百分位，回答「現在這個本益比在自己的歷史裡算貴還是便宜」"
```

---

### Task 2: 股利與填息

**Files:** Create `artifacts/api-server/src/lib/dividend.ts`、`dividend.test.ts`

**Interfaces:**
- Produces:
  - `interface DividendRow { date: string; CashEarningsDistribution: number | null; StockEarningsDistribution: number | null }`
  - `interface DividendResultRow { date: string; before_price: number | null; after_price: number | null; max_price: number | null }`
  - `interface DividendSummary { consecutiveYears, latestYear, latestCash, avgCash5y, coverageFrom, filled, filledTotal }`
  - `buildDividend(rows: DividendRow[], results: DividendResultRow[]): DividendSummary`

- [ ] **Step 1: 測試**

```ts
import { describe, expect, it } from "vitest";
import { buildDividend, type DividendRow, type DividendResultRow } from "./dividend";

const cash = (date: string, amount: number): DividendRow => ({
  date,
  CashEarningsDistribution: amount,
  StockEarningsDistribution: 0,
});

describe("buildDividend", () => {
  it("連續配息年數從最新年度往回數到斷層為止", () => {
    // 2412 中華電的真實形狀：2005~2008 有、2009 缺、2010 之後連續。
    // 直接算「有配息的年數」會得到 8，但連續只有 4 年。
    const rows = [
      cash("2005-08-01", 4.7),
      cash("2006-08-01", 4.3),
      cash("2007-08-01", 3.58),
      cash("2008-08-01", 4.26),
      cash("2010-08-01", 4.06),
      cash("2011-08-01", 5.52),
      cash("2012-08-01", 5.46),
      cash("2013-08-01", 4.63),
    ];
    expect(buildDividend(rows, []).consecutiveYears).toBe(4);
  });

  it("同一年多次配息（季配）只算一年", () => {
    const rows = [
      cash("2025-03-18", 4.5),
      cash("2025-06-12", 4.5),
      cash("2025-09-16", 4.5),
      cash("2026-03-18", 5.0),
    ];
    expect(buildDividend(rows, []).consecutiveYears).toBe(2);
  });

  it("同一年多次配息時，最近年度的現金股利是該年總和", () => {
    const rows = [cash("2026-03-18", 2.5), cash("2026-06-12", 3.0)];
    expect(buildDividend(rows, []).latestCash).toBeCloseTo(5.5, 6);
  });

  it("配息為零的年度視為中斷 —— 那一年並沒有配息", () => {
    const rows = [cash("2024-08-01", 3), cash("2025-08-01", 0), cash("2026-08-01", 4)];
    expect(buildDividend(rows, []).consecutiveYears).toBe(1);
  });

  it("標出資料涵蓋起點 —— 文案只能寫「2005 年起連續 N 年」，不能宣稱完整歷史", () => {
    const rows = [cash("2005-08-01", 4.7), cash("2006-08-01", 4.3)];
    expect(buildDividend(rows, []).coverageFrom).toBe("2005");
  });

  it("填息以除息後是否曾漲回除息前價位判定", () => {
    const results: DividendResultRow[] = [
      { date: "2025-03-18", before_price: 970, after_price: 965.49, max_price: 1060 },
      { date: "2025-06-12", before_price: 1065, after_price: 1060.49, max_price: 1000 },
    ];
    const d = buildDividend([], results);
    expect(d.filledTotal).toBe(2);
    expect(d.filled).toBe(1); // 第一次 max 1060 > 970 填息；第二次 1000 < 1065 未填
  });

  it("缺價位的除息紀錄不計入填息統計，不當成失敗", () => {
    const results: DividendResultRow[] = [
      { date: "2025-03-18", before_price: null, after_price: null, max_price: null },
    ];
    const d = buildDividend([], results);
    expect(d.filledTotal).toBe(0);
  });

  it("空輸入不崩潰", () => {
    const d = buildDividend([], []);
    expect(d.consecutiveYears).toBe(0);
    expect(d.latestCash).toBeNull();
    expect(d.coverageFrom).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: 實作**

```ts
/**
 * 股利政策與填息紀錄。
 *
 * 存股族的核心問題是「它撐得住嗎」，而那要看連續配息的年數與填息能力，
 * 不是月營收 YoY。這一塊是這個 App 先前對存股族完全沒有的東西。
 *
 * 年度一律取 `date` 的西元年 —— FinMind 的 `year` 欄位是民國格式
 * （`"93年"`、`"113年第3季"`），拿來排序或比較都會錯。
 */

export interface DividendRow {
  date: string;
  CashEarningsDistribution: number | null;
  StockEarningsDistribution: number | null;
}

export interface DividendResultRow {
  date: string;
  before_price: number | null;
  after_price: number | null;
  /** 除息後至今的最高價 —— 用來判定是否填息 */
  max_price: number | null;
}

export interface DividendSummary {
  /** 從最新年度往回數的連續配息年數 */
  consecutiveYears: number;
  latestYear: string | null;
  /** 最近一個年度的現金股利合計（季配會有多筆） */
  latestCash: number | null;
  /** 近五個有配息年度的平均現金股利 */
  avgCash5y: number | null;
  /** 資料涵蓋的最早年度。文案只能寫「N 年起」，不能宣稱完整歷史 */
  coverageFrom: string | null;
  /** 填息成功次數 */
  filled: number;
  /** 可判定的除息次數（缺價位者不計） */
  filledTotal: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildDividend(
  rows: DividendRow[],
  results: DividendResultRow[],
): DividendSummary {
  // 依西元年彙總現金股利。季配的公司同一年會有多筆，必須加總而非取其一。
  const byYear = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.date !== "string" || r.date.length < 4) continue;
    const year = r.date.slice(0, 4);
    const cash = Number.isFinite(r.CashEarningsDistribution) ? r.CashEarningsDistribution! : 0;
    byYear.set(year, (byYear.get(year) ?? 0) + cash);
  }

  const years = [...byYear.keys()].sort();
  const paidYears = years.filter((y) => (byYear.get(y) ?? 0) > 0);
  const latestYear = paidYears[paidYears.length - 1] ?? null;

  // 從最新的有配息年度往回數，遇到斷層即停 —— 直接算「有配息的年數」
  // 會把 2412 這種中間缺一年的情況算成連續，而那不是同一件事。
  let consecutiveYears = 0;
  if (latestYear !== null) {
    let cursor = Number(latestYear);
    while (byYear.has(String(cursor)) && (byYear.get(String(cursor)) ?? 0) > 0) {
      consecutiveYears += 1;
      cursor -= 1;
    }
  }

  const last5 = paidYears.slice(-5).map((y) => byYear.get(y)!);
  const avgCash5y =
    last5.length > 0 ? round2(last5.reduce((a, b) => a + b, 0) / last5.length) : null;

  // 填息：除息後的最高價曾回到除息前價位即算填息。
  // 缺任一價位者不計入分母 —— 判不出來不該算成失敗。
  let filled = 0;
  let filledTotal = 0;
  for (const r of results) {
    if (
      r.before_price == null ||
      r.max_price == null ||
      !Number.isFinite(r.before_price) ||
      !Number.isFinite(r.max_price)
    ) {
      continue;
    }
    filledTotal += 1;
    if (r.max_price >= r.before_price) filled += 1;
  }

  return {
    consecutiveYears,
    latestYear,
    latestCash: latestYear !== null ? round2(byYear.get(latestYear)!) : null,
    avgCash5y,
    coverageFrom: years[0] ?? null,
    filled,
    filledTotal,
  };
}
```

- [ ] **Step 4: 測試通過、typecheck、提交**

```bash
git commit -m "股利與填息統計，存股族第一次有東西可看"
```

---

### Task 3: 財報三表 pivot 與品質比率

**Files:** Create `artifacts/api-server/src/lib/financials.ts`、`financials.test.ts`

**Interfaces:**
- Produces:
  - `interface StatementRow { date: string; type: string; value: number | null }`
  - `interface QuarterMetrics { date, grossMargin, operatingMargin, netMargin, eps, roe, debtRatio, fcf }`
  - `buildFinancials(income, balance, cashflow): { quarters: QuarterMetrics[]; asOf: string | null }`

- [ ] **Step 1: 測試**

```ts
import { describe, expect, it } from "vitest";
import { buildFinancials, type StatementRow } from "./financials";

const row = (date: string, type: string, value: number): StatementRow => ({ date, type, value });

const income = [
  row("2025-03-31", "Revenue", 1000),
  row("2025-03-31", "GrossProfit", 600),
  row("2025-03-31", "OperatingIncome", 400),
  row("2025-03-31", "IncomeAfterTaxes", 300),
  row("2025-03-31", "EPS", 12.5),
];
const balance = [
  row("2025-03-31", "Equity", 3000),
  row("2025-03-31", "Liabilities", 2000),
  row("2025-03-31", "TotalAssets", 5000),
];
const cashflow = [
  row("2025-03-31", "NetCashInflowFromOperatingActivities", 500),
  row("2025-03-31", "PropertyAndPlantAndEquipment", -200),
];

describe("buildFinancials", () => {
  it("把長格式的一列一科目轉成一季一物件", () => {
    const f = buildFinancials(income, balance, cashflow);
    expect(f.quarters).toHaveLength(1);
    expect(f.quarters[0]!.date).toBe("2025-03-31");
  });

  it("毛利率與營益率以營收為分母", () => {
    const q = buildFinancials(income, balance, cashflow).quarters[0]!;
    expect(q.grossMargin).toBeCloseTo(60, 6);
    expect(q.operatingMargin).toBeCloseTo(40, 6);
    expect(q.netMargin).toBeCloseTo(30, 6);
  });

  it("ROE 需要跨損益表與資產負債表兩張表", () => {
    const q = buildFinancials(income, balance, cashflow).quarters[0]!;
    expect(q.roe).toBeCloseTo(10, 6); // 300 / 3000
  });

  it("負債比以總資產為分母", () => {
    expect(buildFinancials(income, balance, cashflow).quarters[0]!.debtRatio).toBeCloseTo(40, 6);
  });

  it("自由現金流是營運現金流減資本支出，資本支出取絕對值", () => {
    // FinMind 的資本支出是負數（現金流出），直接相加會變成加總
    expect(buildFinancials(income, balance, cashflow).quarters[0]!.fcf).toBeCloseTo(300, 6);
  });

  it("EPS 直接取用，不自己除股數", () => {
    expect(buildFinancials(income, balance, cashflow).quarters[0]!.eps).toBeCloseTo(12.5, 6);
  });

  it("缺科目時該比率為 null，不用零硬湊", () => {
    const f = buildFinancials([row("2025-03-31", "Revenue", 1000)], [], []);
    const q = f.quarters[0]!;
    expect(q.grossMargin).toBeNull();
    expect(q.roe).toBeNull();
    expect(q.fcf).toBeNull();
  });

  it("分母為零時回 null 而非 Infinity", () => {
    const f = buildFinancials(
      [row("2025-03-31", "Revenue", 0), row("2025-03-31", "GrossProfit", 600)],
      [row("2025-03-31", "Equity", 0), row("2025-03-31", "IncomeAfterTaxes", 300)],
      [],
    );
    expect(f.quarters[0]!.grossMargin).toBeNull();
    expect(f.quarters[0]!.roe).toBeNull();
  });

  it("多季時由新到舊排序，asOf 為最新一季", () => {
    const two = [
      ...income,
      row("2025-06-30", "Revenue", 2000),
      row("2025-06-30", "GrossProfit", 1000),
    ];
    const f = buildFinancials(two, balance, cashflow);
    expect(f.quarters[0]!.date).toBe("2025-06-30");
    expect(f.asOf).toBe("2025-06-30");
  });

  it("空輸入不崩潰", () => {
    const f = buildFinancials([], [], []);
    expect(f.quarters).toEqual([]);
    expect(f.asOf).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

- [ ] **Step 3: 實作**

```ts
/**
 * 財報三表的長格式轉換與品質比率。
 *
 * FinMind 的三張報表回傳的是**長格式** —— 一列一個科目
 * （`{date, type: "GrossProfit", value: 600, origin_name: "營業毛利"}`），
 * 不是一列一季。要算任何比率都得先 pivot 成「一季一物件」。
 *
 * ROE 必須跨兩張表（稅後淨利 ÷ 股東權益），這是為什麼三張表要一起處理
 * 而不是各自算完再合併。
 *
 * 缺科目或分母為零時該比率為 null —— 用零硬湊會產生看起來正常的假數字，
 * 而財報比率正是使用者最不會去複查的那一種。
 */

export interface StatementRow {
  date: string;
  type: string;
  value: number | null;
}

export interface QuarterMetrics {
  date: string;
  /** 毛利率（%） */
  grossMargin: number | null;
  /** 營益率（%） */
  operatingMargin: number | null;
  /** 淨利率（%） */
  netMargin: number | null;
  eps: number | null;
  /** 股東權益報酬率（%）。單季值，非年化 */
  roe: number | null;
  /** 負債比（%） */
  debtRatio: number | null;
  /** 自由現金流 = 營運現金流 − 資本支出 */
  fcf: number | null;
}

export interface Financials {
  /** 由新到舊 */
  quarters: QuarterMetrics[];
  asOf: string | null;
}

/** 長格式 → Map<date, Map<type, value>> */
function pivot(rows: StatementRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (typeof r.date !== "string" || typeof r.type !== "string") continue;
    if (r.value == null || !Number.isFinite(r.value)) continue;
    const q = out.get(r.date) ?? new Map<string, number>();
    q.set(r.type, r.value);
    out.set(r.date, q);
  }
  return out;
}

/** 比率。分母缺席或為零時回 null，不產生 Infinity 或用零硬湊 */
function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Math.round((numerator / denominator) * 100 * 100) / 100;
}

export function buildFinancials(
  income: StatementRow[],
  balance: StatementRow[],
  cashflow: StatementRow[],
): Financials {
  const inc = pivot(income);
  const bal = pivot(balance);
  const cf = pivot(cashflow);

  // 以損益表的季別為準：沒有損益表就算不出任何一個比率
  const dates = [...inc.keys()].sort().reverse();

  const quarters: QuarterMetrics[] = dates.map((date) => {
    const i = inc.get(date);
    const b = bal.get(date);
    const c = cf.get(date);

    const revenue = i?.get("Revenue");
    const netIncome = i?.get("IncomeAfterTaxes");
    const operating = c?.get("NetCashInflowFromOperatingActivities");
    // FinMind 的資本支出是負數（現金流出）。直接相加會變成加總而不是相減，
    // 算出來的自由現金流會比實際大一倍以上。
    const capex = c?.get("PropertyAndPlantAndEquipment");

    const eps = i?.get("EPS");

    return {
      date,
      grossMargin: ratio(i?.get("GrossProfit"), revenue),
      operatingMargin: ratio(i?.get("OperatingIncome"), revenue),
      netMargin: ratio(netIncome, revenue),
      eps: eps != null && Number.isFinite(eps) ? eps : null,
      roe: ratio(netIncome, b?.get("Equity")),
      debtRatio: ratio(b?.get("Liabilities"), b?.get("TotalAssets")),
      fcf:
        operating != null && capex != null
          ? Math.round(operating - Math.abs(capex))
          : null,
    };
  });

  return { quarters, asOf: dates[0] ?? null };
}
```

- [ ] **Step 4: 測試通過、typecheck、提交**

```bash
git commit -m "財報三表 pivot 與品質比率，護城河改用數字表達"
```

---

### Task 4: 後端接線與契約

**Files:** Modify `dailyCache.ts`、`routes/stock.ts`、`routes/index.ts`、`openapi.yaml`；Create `routes/fundamentals.ts`

- [ ] **Step 1: 快取鍵**

`dailyCache.ts`：`stockCacheKey` 的 `v5` → `v6`，並加入：

```ts
/** 財報資料的日快取。季頻更新，但仍以日失效即可 —— 多抓幾次無妨，少抓才是問題 */
export function fundamentalsCacheKey(code: string): string {
  return `fundamentals|v1|${code.trim().toLowerCase()}`;
}
```

- [ ] **Step 2: 主流程加 PER 與股利**

`routes/stock.ts`：import `buildValuation` / `buildDividend` 與型別，在 `Promise.all` 加三個 fetch（`TaiwanStockPER` 起始日 `dateMinusDays(1830)`≈五年、`TaiwanStockDividend` 起始日 `1990-01-01`、`TaiwanStockDividendResult` 起始日 `dateMinusDays(1830)`），payload 加：

```ts
      valuation: buildValuation(perRows),
      dividend: buildDividend(dividendRows, dividendResultRows),
```

**注意：** PER 五年約 1,461 筆／檔。`buildValuation` 只回傳統計結果，原始序列**不進 payload** —— 否則五檔會讓回應多出約 675 KB，而那還要存進 localStorage 快照。

- [ ] **Step 3: 財報延後載入端點**

Create `artifacts/api-server/src/routes/fundamentals.ts`，`GET /api/stock/:code/fundamentals`，抓三張表（起始日 `dateMinusMonths(36)`，約 12 季），走 `fundamentalsCacheKey` 日快取，回傳 `buildFinancials(...)` 的結果。抓不到回 `{ quarters: [], asOf: null }` 而非 500。

在 `routes/index.ts` 掛上。

- [ ] **Step 4: 契約與 codegen**

`openapi.yaml` 加 `MetricBand`、`Valuation`、`DividendSummary`、`QuarterMetrics`、`Financials` 五個 schema，`StockDetailResult` 加 `valuation`／`dividend`，新增 `/stock/{code}/fundamentals` 端點。

Run: `npx pnpm --filter @workspace/api-spec run codegen`

- [ ] **Step 5: 測試、typecheck、提交**

---

### Task 5: lib/view-profile

**Files:** Create `lib/view-profile/`（package.json、tsconfig、src/index.ts、src/index.test.ts）

**重要：** 這個套件只被 Vite 消費（純前端），因此可以直接匯出 `.ts`，比照 `lib/api-zod`。**不要**比照 `lib/advice` 匯出編譯後的 JS —— 那是因為它進了 Netlify 函式的相依圖。

**Interfaces:**
- Produces：`ViewProfile`、`SectionKey`、`ViewConfig`、`VIEW_CONFIG`、`viewFor(profile)`、`PROFILES`（給切換器用的清單）

- [ ] 依 `lib/api-zod` 的 package.json 建立套件骨架，`exports` 指向 `./src/index.ts`
- [ ] 測試涵蓋：每個 profile 的 `show` 不為空、`viewFor` 對未知值退回 `swing`、value/dividend 不含 `trading_plan`、newbie 不含 `expected_value`
- [ ] 實作 `VIEW_CONFIG` 對照表（五個 profile × SectionKey union）
- [ ] 加進 `pnpm-workspace.yaml` 與 `artifacts/web` 的相依

---

### Task 6: 受眾切換器與卡片套用

**Files:** Create `profile-switcher.tsx`；Modify `stock-card.tsx`、`analysis.tsx`

- [ ] 切換器：五個按鈕（新手／動能／波段／價值／存股），狀態存 localStorage（`view_profile_v1`），預設 `swing`
- [ ] `analysis.tsx` 持有 profile 狀態，傳進每張卡片
- [ ] `stock-card.tsx` 依 `viewFor(profile).show` 包裹各區塊
- [ ] **動能視圖的定位文案**：標明「數日～數週，非當沖 —— 日線資料延遲一天」
- [ ] 新手視圖的術語翻譯：「站上雙均線」→「股價在近月與近季平均之上（偏強）」

---

### Task 7: 估值與股利面板

**Files:** Create `valuation-panel.tsx`；Modify `stock-card.tsx`

- [ ] `ValuationPanel`：PE／PB／殖利率三帶，各顯示 current + percentile + 區間端點，並標明樣本數與 `asOf`
- [ ] `DividendPanel`：連續配息年數（文案必須是「{coverageFrom} 年起連續 N 年」）、最近年度現金股利、填息 N/M
- [ ] `FinancialsPanel`：呼叫延後載入端點，顯示毛利率／營益率／ROE／負債比／FCF 的多季趨勢，並標明「資料截至 {asOf}」
- [ ] 三者只在 `value` 與 `dividend` 視圖顯示
- [ ] 資料缺席時整塊不渲染

---

## 完成標準

- [ ] `npx vitest run` 全綠（用退出碼判斷）
- [ ] `npx pnpm run typecheck` 全綠
- [ ] `npx pnpm run build` 成功
- [ ] `stockCacheKey` 前綴為 `v6`
- [ ] `RULE_VERSION` 仍為 3
- [ ] PER 原始序列未進 payload（只有統計結果）
- [ ] 財報走獨立端點，不在首次查詢的 `Promise.all` 內
- [ ] 五個視圖各自可切換，切換不觸發任何網路請求（財報面板首次展開除外）
