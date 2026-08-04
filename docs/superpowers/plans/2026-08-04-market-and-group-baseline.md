# 大盤與族群基準 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓「上升趨勢」這個結論有基準可比 —— 補上加權指數與同供應鏈的相對強弱，使用者才分得出這是大盤帶上去的、還是這檔自己強。

**Architecture:** 大盤走 `TaiwanStockPrice&data_id=TAIEX`，與個股**完全相同的資料集與型別**，因此沿用既有的 `PriceRow` 與 `indicators.ts`。用獨立的日快取存放算好的 `MarketContext`，使一次分析只多 **1 次** FinMind 請求而非每檔一次。族群相對強弱完全在前端算 —— `analysis.tsx` 已握有同一條供應鏈全部標的的明細，排序不需要任何額外請求。

**Tech Stack:** TypeScript 5.9、React 19、Vitest 4、Express 5、FinMind、OpenAPI + Orval

## Global Constraints

- **直接在 `main` 上工作**，不開功能分支。
- **不動 `RULE_VERSION`（目前為 3）。** 大盤與族群資料**只陳述、不進評分** —— 與 `signal-list.tsx:30-34` 既有決定同一個理由：評分本來就未經回測，再塞進未驗證的權重只會讓它更難歸因。
- **必須遞增 `stockCacheKey` 的版本前綴**（`artifacts/api-server/src/lib/dailyCache.ts:72`，目前 `v4` → `v5`）。快取雖以日失效，但部署當天稍早寫入的 payload 缺少新欄位，不遞增的話使用者會拿到少一截欄位的回應直到隔天，而畫面對缺欄位的處理是整塊不渲染 —— 看起來就像功能沒上線。
- **契約先改 `lib/api-spec/openapi.yaml`**，再跑 `pnpm --filter @workspace/api-spec run codegen`。
- 舊 localStorage 快照沒有新欄位，一律「缺值就整塊不渲染」。
- 每個 Task 結束前跑 `pnpm test` 與 `pnpm run typecheck`，兩者皆綠才提交。
- 測試不呼叫外部 API；純函式不讀時鐘。

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `artifacts/api-server/src/lib/indicators.ts` | 加 `calcReturn` | 修改 |
| `artifacts/api-server/src/lib/indicators.test.ts` | 同上測試 | 修改 |
| `artifacts/api-server/src/lib/market.ts` | 大盤脈絡與相對強弱純函式 | 建立 |
| `artifacts/api-server/src/lib/market.test.ts` | 同上測試 | 建立 |
| `artifacts/api-server/src/routes/stock.ts` | 抓 TAIEX、獨立日快取、payload 加欄位 | 修改 |
| `artifacts/api-server/src/lib/dailyCache.ts` | 版本前綴 v4 → v5、加 `marketCacheKey` | 修改 |
| `lib/api-spec/openapi.yaml` | `MarketContext`、`Returns` schema | 修改 |
| `artifacts/web/src/components/stock/market-panel.tsx` | 相對大盤與系統性風險提示 | 建立 |
| `artifacts/web/src/lib/groupStrength.ts` | 族群內排名純函式 | 建立 |
| `artifacts/web/src/lib/groupStrength.test.ts` | 同上測試 | 建立 |
| `artifacts/web/src/components/stock-card.tsx` | 掛上 MarketPanel 與族群排名 | 修改 |
| `artifacts/web/src/pages/analysis.tsx` | 算族群排名並傳入 | 修改 |

---

### Task 1: N 日報酬純函式

**Files:**
- Modify: `artifacts/api-server/src/lib/indicators.ts`
- Test: `artifacts/api-server/src/lib/indicators.test.ts`

**Interfaces:**
- Produces: `calcReturn(closes: number[], days: number): number | null` —— 回傳百分比（漲 3% 回 `3`，不是 `0.03`）

- [ ] **Step 1: 寫失敗的測試**

在 `artifacts/api-server/src/lib/indicators.test.ts` 末尾加入：

```ts
describe("calcReturn", () => {
  it("回傳百分比而非小數 —— 與畫面上其他百分比欄位一致", () => {
    // 100 → 110，五個交易日
    expect(calcReturn([100, 101, 102, 103, 104, 110], 5)).toBeCloseTo(10, 6);
  });

  it("下跌回負值", () => {
    expect(calcReturn([100, 99, 98, 97, 96, 90], 5)).toBeCloseTo(-10, 6);
  });

  it("只看頭尾兩根，中間的路徑不影響結果", () => {
    const straight = calcReturn([100, 105, 110], 2);
    const volatile = calcReturn([100, 200, 110], 2);
    expect(straight).toBeCloseTo(volatile!, 6);
  });

  it("資料不足 days+1 根時回 null，不用短一截的區間硬湊", () => {
    expect(calcReturn([100, 110], 5)).toBeNull();
    expect(calcReturn([], 1)).toBeNull();
  });

  it("剛好 days+1 根就算得出來", () => {
    expect(calcReturn([100, 110], 1)).toBeCloseTo(10, 6);
  });

  it("起始價為零或負數時回 null，不產生 Infinity", () => {
    expect(calcReturn([0, 110], 1)).toBeNull();
    expect(calcReturn([-5, 110], 1)).toBeNull();
  });

  it("days 非正數時回 null", () => {
    expect(calcReturn([100, 110], 0)).toBeNull();
    expect(calcReturn([100, 110], -3)).toBeNull();
  });
});
```

並確認檔案頂端的 import 已含 `calcReturn`。

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run artifacts/api-server/src/lib/indicators.test.ts`
Expected: FAIL，`calcReturn` is not a function／找不到匯出

- [ ] **Step 3: 寫實作**

在 `artifacts/api-server/src/lib/indicators.ts` 的 `calcMA` 之後加入：

```ts
/**
 * N 個交易日的報酬率（%）。
 *
 * 只取頭尾兩根收盤價 —— 中間怎麼走與「這段期間漲跌多少」無關。
 * 回傳百分比而非小數，與畫面上其他百分比欄位（月營收 YoY、E(V)）一致，
 * 少了這個約定會在某一層被乘或除 100 兩次。
 *
 * 資料不足 days+1 根時回 null：拿短一截的區間硬湊會讓不同標的的
 * 「20 日報酬」實際上是不同長度，相對強弱就失去意義。
 */
export function calcReturn(closes: number[], days: number): number | null {
  if (days <= 0) return null;
  if (closes.length < days + 1) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - days]!;
  if (!(then > 0) || !Number.isFinite(now)) return null;
  return ((now - then) / then) * 100;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run artifacts/api-server/src/lib/indicators.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
npx pnpm run typecheck
git add artifacts/api-server/src/lib/indicators.ts artifacts/api-server/src/lib/indicators.test.ts
git commit -m "加 N 日報酬純函式，相對強弱的計算基礎"
```

---

### Task 2: 大盤脈絡與相對強弱

**Files:**
- Create: `artifacts/api-server/src/lib/market.ts`
- Test: `artifacts/api-server/src/lib/market.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `calcReturn`；既有的 `calcMA`、`PriceRow`
- Produces:
  - `type MarketMaSignal = 'above_both' | 'above_ma20' | 'below_both' | 'insufficient_data'`
  - `interface MarketContext { return5d, return20d, return60d: number | null; maSignal: MarketMaSignal; asOf: string | null }`
  - `buildMarketContext(rows: PriceRow[]): MarketContext`
  - `interface RelativeStrength { d5, d20, d60: number | null }`
  - `buildRelativeStrength(stock: Returns, market: MarketContext): RelativeStrength`
  - `interface Returns { d5, d20, d60: number | null }`
  - `buildReturns(closes: number[]): Returns`

- [ ] **Step 1: 寫失敗的測試**

建立 `artifacts/api-server/src/lib/market.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { buildMarketContext, buildRelativeStrength, buildReturns } from "./market";
import type { PriceRow } from "./indicators";

/** 產生 n 根等差上漲的日線，收盤自 start 起每根 +step */
function rows(n: number, start = 100, step = 1): PriceRow[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return {
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      open: close,
      max: close,
      min: close,
      close,
      Trading_Volume: 1000,
    } as PriceRow;
  });
}

describe("buildReturns", () => {
  it("三個天期各自獨立計算", () => {
    const closes = rows(80).map((r) => r.close);
    const r = buildReturns(closes);
    expect(r.d5).not.toBeNull();
    expect(r.d20).not.toBeNull();
    expect(r.d60).not.toBeNull();
    // 等差上漲，長天期的報酬必定大於短天期
    expect(r.d60!).toBeGreaterThan(r.d20!);
    expect(r.d20!).toBeGreaterThan(r.d5!);
  });

  it("資料只夠短天期時，長天期為 null 而非硬湊", () => {
    const closes = rows(10).map((r) => r.close);
    const r = buildReturns(closes);
    expect(r.d5).not.toBeNull();
    expect(r.d20).toBeNull();
    expect(r.d60).toBeNull();
  });
});

describe("buildMarketContext", () => {
  it("持續上漲時站上雙均線", () => {
    expect(buildMarketContext(rows(80)).maSignal).toBe("above_both");
  });

  it("持續下跌時跌破雙均線 —— 這是系統性風險提示的觸發條件", () => {
    expect(buildMarketContext(rows(80, 200, -1)).maSignal).toBe("below_both");
  });

  it("資料不足以算出 MA60 時明講資料不足，不退回二態", () => {
    expect(buildMarketContext(rows(30)).maSignal).toBe("insufficient_data");
  });

  it("空輸入不崩潰，全部為 null", () => {
    const m = buildMarketContext([]);
    expect(m.maSignal).toBe("insufficient_data");
    expect(m.return20d).toBeNull();
    expect(m.asOf).toBeNull();
  });

  it("asOf 取最後一根的日期 —— 大盤與個股的資料日期未必同步", () => {
    expect(buildMarketContext(rows(80)).asOf).toBe(rows(80)[79]!.date);
  });
});

describe("buildRelativeStrength", () => {
  const market = { return5d: 3, return20d: 10, return60d: 20, maSignal: "above_both" as const, asOf: "2026-08-03" };

  it("相對強弱是個股報酬減大盤報酬，單位是百分點", () => {
    const rs = buildRelativeStrength({ d5: 5, d20: 8, d60: 20 }, market);
    expect(rs.d5).toBeCloseTo(2, 6);
    // 個股漲 8% 而大盤漲 10% —— 絕對值是正的，相對大盤卻是輸的，
    // 而這正是目前畫面看不出來的那件事
    expect(rs.d20).toBeCloseTo(-2, 6);
    expect(rs.d60).toBeCloseTo(0, 6);
  });

  it("任一邊缺值時該天期為 null，不當成零", () => {
    const rs = buildRelativeStrength({ d5: 5, d20: null, d60: 1 }, { ...market, return60d: null });
    expect(rs.d5).toBeCloseTo(2, 6);
    expect(rs.d20).toBeNull();
    expect(rs.d60).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run artifacts/api-server/src/lib/market.test.ts`
Expected: FAIL，找不到模組 `./market`

- [ ] **Step 3: 寫實作**

建立 `artifacts/api-server/src/lib/market.ts`：

```ts
/**
 * 大盤脈絡與相對強弱。
 *
 * 為什麼需要：`detectTrend` 判定「上升趨勢」看的是個股自己的均線。
 * 大盤同期漲 15%、個股漲 8%，畫面照樣寫「上升趨勢」—— 但它其實輸給大盤。
 * 大多頭時幾乎每檔都會站上雙均線、每檔都拿到高分，那是 beta 不是 alpha。
 *
 * 加權指數走的是**與個股完全相同的資料集**（`TaiwanStockPrice`，
 * `data_id=TAIEX`），因此沿用同一組 `PriceRow` 與 `indicators.ts`，
 * 不需要另一套解析。
 *
 * 純計算，不涉及 HTTP 也不讀環境變數，因此可獨立測試。
 * 這些數值**只做顯示，不進評分** —— 評分本來就未經回測，
 * 再塞進未驗證的權重只會讓它更難歸因（與 signals 同一個決定）。
 */

import { calcMA, calcReturn, type PriceRow } from "./indicators";

export type MarketMaSignal = "above_both" | "above_ma20" | "below_both" | "insufficient_data";

export interface Returns {
  /** 近 5 個交易日報酬（%） */
  d5: number | null;
  /** 近 20 個交易日報酬（%） */
  d20: number | null;
  /** 近 60 個交易日報酬（%） */
  d60: number | null;
}

export interface MarketContext {
  return5d: number | null;
  return20d: number | null;
  return60d: number | null;
  /** 加權指數自身的均線位置。below_both 即為系統性風險提示的觸發條件 */
  maSignal: MarketMaSignal;
  /** 大盤資料的最後日期 —— 與個股未必同步，因此各自標示 */
  asOf: string | null;
}

/** 三個天期一起算，避免呼叫端各自寫一份而選到不同的天數 */
export function buildReturns(closes: number[]): Returns {
  return {
    d5: calcReturn(closes, 5),
    d20: calcReturn(closes, 20),
    d60: calcReturn(closes, 60),
  };
}

export function buildMarketContext(rows: PriceRow[]): MarketContext {
  const closes = rows.map((r) => r.close).filter((c): c is number => Number.isFinite(c));
  const returns = buildReturns(closes);
  const last = closes[closes.length - 1] ?? null;
  const ma20 = calcMA(closes, 20);
  const ma60 = calcMA(closes, 60);

  // 與個股的 maSignal 用同一組判定，畫面才能並排陳述而不必解釋兩套標準
  let maSignal: MarketMaSignal = "insufficient_data";
  if (last !== null && ma20 !== null && ma60 !== null) {
    if (last >= ma20 && last >= ma60) maSignal = "above_both";
    else if (last >= ma20) maSignal = "above_ma20";
    else maSignal = "below_both";
  }

  return {
    return5d: returns.d5,
    return20d: returns.d20,
    return60d: returns.d60,
    maSignal,
    asOf: rows[rows.length - 1]?.date ?? null,
  };
}

/** 個股報酬減大盤報酬，單位是百分點。任一邊缺值即為 null —— 不當成零 */
export function buildRelativeStrength(stock: Returns, market: MarketContext): Returns {
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  return {
    d5: diff(stock.d5, market.return5d),
    d20: diff(stock.d20, market.return20d),
    d60: diff(stock.d60, market.return60d),
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run artifacts/api-server/src/lib/market.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
npx pnpm run typecheck
git add artifacts/api-server/src/lib/market.ts artifacts/api-server/src/lib/market.test.ts
git commit -m "大盤脈絡與相對強弱純函式，上升趨勢終於有基準可比"
```

---

### Task 3: 接進 /stock 路由與契約

**Files:**
- Modify: `artifacts/api-server/src/lib/dailyCache.ts:63-73`
- Modify: `artifacts/api-server/src/routes/stock.ts`
- Modify: `lib/api-spec/openapi.yaml`

**Interfaces:**
- Consumes: Task 2 的 `buildMarketContext`、`buildReturns`、`buildRelativeStrength`
- Produces: `StockDetailResult` 新增 `returns`、`relativeStrength`、`market` 三個選用物件

- [ ] **Step 1: 加大盤快取鍵並遞增個股快取版本**

修改 `artifacts/api-server/src/lib/dailyCache.ts`，把 `stockCacheKey` 的 `v4` 改成 `v5`：

```ts
export function stockCacheKey(code: string, period: string): string {
  return `stock|v5|${code.trim().toLowerCase()}|${period}`;
}
```

並在其後加入：

```ts
/**
 * 大盤脈絡的快取鍵。
 *
 * 與個股分開存是關鍵：一次分析要查 3~5 檔，若在每檔的流程裡各抓一次
 * 加權指數，就是每次分析多 3~5 個 FinMind 請求。獨立成一個以日為單位的
 * 項目之後，當天第一檔查詢抓一次，其餘全部命中快取 —— 實際成本是
 * 每日 +1 個請求。不帶週期：大盤脈絡與使用者選的持有期無關。
 */
export function marketCacheKey(): string {
  return "market|v1|TAIEX";
}
```

- [ ] **Step 2: 路由抓取大盤並快取**

在 `artifacts/api-server/src/routes/stock.ts` 的 import 區加入：

```ts
import { marketCacheKey, stockCacheKey, today } from "../lib/dailyCache";
import { buildMarketContext, buildRelativeStrength, buildReturns, type MarketContext } from "../lib/market";
```

（把原本的 `import { stockCacheKey, today } from "../lib/dailyCache";` 換掉。）

在 `const stockCache = dailyCacheFor<Record<string, unknown>>();` 之後加入：

```ts
/** 大盤脈絡的日快取。與個股分開，讓一次分析只多 1 個 FinMind 請求 */
const marketCache = dailyCacheFor<MarketContext>();

/**
 * 取得當日大盤脈絡。
 *
 * 抓不到時回 null 而非丟例外 —— 與 fetchFinMind 的失敗策略一致：
 * 少了大盤脈絡，個股自己的計畫仍然完全有效，整個請求失敗反而讓
 * 使用者什麼都看不到。
 */
async function getMarketContext(day: string, token: string | undefined): Promise<MarketContext | null> {
  const cached = await marketCache.get(marketCacheKey(), day);
  if (cached) return cached;

  const rows = await fetchFinMind<PriceRow>(
    buildUrl("TaiwanStockPrice", "TAIEX", dateMinusDays(PRICE_FETCH_DAYS), token),
  );
  if (rows.length === 0) return null;

  const context = buildMarketContext(rows);
  await marketCache.set(marketCacheKey(), day, context);
  return context;
}
```

- [ ] **Step 3: 在 Promise.all 併入大盤**

把既有的 `const [prices, revenues, institutionals, info] = await Promise.all([...])` 改為五元素：

```ts
    const [prices, revenues, institutionals, info, market] = await Promise.all([
      fetchFinMind<PriceRow>(buildUrl("TaiwanStockPrice", code, dateMinusDays(PRICE_FETCH_DAYS), token)),
      fetchFinMind<RevenueRow>(buildUrl("TaiwanStockMonthRevenue", code, dateMinusMonths(15), token)),
      fetchFinMind<InstitutionalRow>(
        buildUrl("TaiwanStockInstitutionalInvestorsBuySell", code, dateMinusDays(CHIPS_FETCH_DAYS), token),
      ),
      resolveStock(code),
      // 與個股平行抓，不佔用額外的往返時間；命中日快取時完全不發請求
      getMarketContext(day, token),
    ]);
```

- [ ] **Step 4: payload 加三個欄位**

在 `const payload = {` 內，於 `avgVolume20` 之後加入：

```ts
      // 個股自身的多天期報酬。相對強弱要用，畫面也直接顯示 ——
      // 少了絕對報酬，使用者看到「相對大盤 +3%」無從判斷是兩者都漲還是兩者都跌。
      returns: buildReturns(closes),
      // 相對大盤。null 代表當日抓不到加權指數，畫面整塊不渲染。
      relativeStrength: market ? buildRelativeStrength(buildReturns(closes), market) : null,
      market,
```

- [ ] **Step 5: 更新契約**

在 `lib/api-spec/openapi.yaml` 的 `components.schemas` 加入兩個新 schema（放在 `OutcomeTally` 之前）：

```yaml
    Returns:
      type: object
      properties:
        d5:
          type: number
          nullable: true
          description: 近 5 個交易日報酬（%）
        d20:
          type: number
          nullable: true
          description: 近 20 個交易日報酬（%）
        d60:
          type: number
          nullable: true
          description: 近 60 個交易日報酬（%）
    MarketContext:
      type: object
      properties:
        return5d:
          type: number
          nullable: true
        return20d:
          type: number
          nullable: true
        return60d:
          type: number
          nullable: true
        maSignal:
          type: string
          enum: [above_both, above_ma20, below_both, insufficient_data]
          description: >-
            加權指數自身的均線位置，判定方式與個股相同。below_both 代表大盤
            跌破雙均線，此時個股停損被觸發的機率上升且會同時發生 ——
            畫面上「分散五檔」的保護在系統性下跌時並不成立。
        asOf:
          type: string
          nullable: true
          description: 大盤資料的最後日期。與個股未必同步，因此各自標示。
```

並在 `StockDetailResult` 的 properties 內加入：

```yaml
        returns:
          $ref: "#/components/schemas/Returns"
        relativeStrength:
          allOf:
            - $ref: "#/components/schemas/Returns"
          nullable: true
          description: >-
            個股報酬減大盤同期報酬，單位是百分點。個股漲 8% 而大盤漲 10% 時
            這裡是 -2 —— 絕對值為正、相對大盤卻是輸的，而那正是只看個股均線
            判不出來的事。當日抓不到加權指數時為 null。
        market:
          allOf:
            - $ref: "#/components/schemas/MarketContext"
          nullable: true
          description: 當日大盤脈絡。抓不到時為 null，畫面整塊不渲染。
```

- [ ] **Step 6: 重新產生型別**

Run: `npx pnpm --filter @workspace/api-spec run codegen`
Expected: `StockDetailResult` 多出 `returns` / `relativeStrength` / `market`

- [ ] **Step 7: 驗證欄位確實產出**

Run: `grep -n "relativeStrength\|MarketContext" lib/api-client-react/src/generated/api.schemas.ts | head`
Expected: 兩者皆出現

- [ ] **Step 8: 全測試、型別檢查、提交**

```bash
npx vitest run && npx pnpm run typecheck
git add -A
git commit -m "接上加權指數，一次分析只多一個請求"
```

---

### Task 4: 族群內相對強弱純函式

**Files:**
- Create: `artifacts/web/src/lib/groupStrength.ts`
- Test: `artifacts/web/src/lib/groupStrength.test.ts`

**Interfaces:**
- Produces:
  - `interface GroupRank { rank: number; total: number; leader: boolean; laggard: boolean }`
  - `rankByStrength(entries: Array<{ code: string; return20d: number | null }>): Record<string, GroupRank>`

- [ ] **Step 1: 寫失敗的測試**

建立 `artifacts/web/src/lib/groupStrength.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { rankByStrength } from './groupStrength';

describe('rankByStrength', () => {
  it('依 20 日報酬由強到弱排名，第一名 rank 為 1', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: 12 },
      { code: 'C', return20d: -3 },
    ]);
    expect(r['B']!.rank).toBe(1);
    expect(r['A']!.rank).toBe(2);
    expect(r['C']!.rank).toBe(3);
    expect(r['B']!.total).toBe(3);
  });

  it('標出族群最強與最弱 —— 使用者要問的是「同一條供應鏈裡它排第幾」', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: 12 },
      { code: 'C', return20d: -3 },
    ]);
    expect(r['B']!.leader).toBe(true);
    expect(r['C']!.laggard).toBe(true);
    expect(r['A']!.leader).toBe(false);
    expect(r['A']!.laggard).toBe(false);
  });

  it('缺報酬的標的不參與排名，也不佔用名次', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: null },
      { code: 'C', return20d: 1 },
    ]);
    expect(r['B']).toBeUndefined();
    expect(r['A']!.rank).toBe(1);
    expect(r['C']!.rank).toBe(2);
    expect(r['A']!.total).toBe(2);
  });

  it('只有一檔可比時不標最強也不標最弱 —— 一檔的排名沒有意義', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: null },
    ]);
    expect(r['A']!.leader).toBe(false);
    expect(r['A']!.laggard).toBe(false);
    expect(r['A']!.total).toBe(1);
  });

  it('同分時名次相同，不因輸入順序而改變', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: 5 },
      { code: 'C', return20d: 1 },
    ]);
    expect(r['A']!.rank).toBe(r['B']!.rank);
    expect(r['C']!.rank).toBe(3);
  });

  it('空輸入回空物件，不崩潰', () => {
    expect(rankByStrength([])).toEqual({});
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run artifacts/web/src/lib/groupStrength.test.ts`
Expected: FAIL，找不到模組

- [ ] **Step 3: 寫實作**

建立 `artifacts/web/src/lib/groupStrength.ts`：

```ts
/**
 * 同一條供應鏈內的相對強弱排名。
 *
 * `/analyze` 已經算出 3~5 檔同族群標的，而 `analysis.tsx` 握有它們全部的
 * 明細 —— 排名因此完全在前端算，不需要任何額外的 API 請求。
 *
 * 為什麼要有：大盤相對強弱回答「這檔贏不贏大盤」，族群排名回答
 * 「同一條供應鏈裡它排第幾」。兩者不能互相取代 —— 整個族群一起強於大盤時，
 * 只看大盤 RS 會覺得每一檔都很好。
 *
 * 用 20 日報酬排序：5 日太短會被單日跳動主導，60 日又慢到反映不出近期輪動。
 * 這個選擇只影響排序依據，不進評分。
 */

export interface GroupRank {
  /** 1 起算，數字越小越強。同分同名次 */
  rank: number;
  /** 參與排名的檔數（不含缺報酬者） */
  total: number;
  leader: boolean;
  laggard: boolean;
}

export function rankByStrength(
  entries: Array<{ code: string; return20d: number | null }>,
): Record<string, GroupRank> {
  // 缺報酬的不參與，也不佔名次 —— 讓它佔一個位置會把其他檔的名次往後推，
  // 而使用者看到的「第 3/5 強」會與實際可比的檔數對不起來。
  const usable = entries.filter(
    (e): e is { code: string; return20d: number } => e.return20d !== null && Number.isFinite(e.return20d),
  );

  const total = usable.length;
  const sorted = [...usable].sort((a, b) => b.return20d - a.return20d);

  const out: Record<string, GroupRank> = {};
  sorted.forEach((entry, i) => {
    // 同分同名次：名次取「第一個同分者的索引 + 1」，不因輸入順序而改變
    const firstSame = sorted.findIndex((e) => e.return20d === entry.return20d);
    const rank = firstSame + 1;
    out[entry.code] = {
      rank,
      total,
      // 只有一檔可比時不標最強也不標最弱 —— 一檔的排名沒有意義
      leader: total > 1 && rank === 1,
      laggard: total > 1 && i === total - 1 && rank !== 1,
    };
  });

  return out;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run artifacts/web/src/lib/groupStrength.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
npx pnpm run typecheck
git add artifacts/web/src/lib/groupStrength.ts artifacts/web/src/lib/groupStrength.test.ts
git commit -m "族群內相對強弱排名，零額外請求"
```

---

### Task 5: 畫面呈現

**Files:**
- Create: `artifacts/web/src/components/stock/market-panel.tsx`
- Modify: `artifacts/web/src/components/stock-card.tsx`
- Modify: `artifacts/web/src/pages/analysis.tsx`

**Interfaces:**
- Consumes: `StockDetailResult.returns` / `.relativeStrength` / `.market`；Task 4 的 `GroupRank`
- Produces: `StockCard` 多一個選用 prop `groupRank?: GroupRank | null`

- [ ] **Step 1: 建立 MarketPanel**

建立 `artifacts/web/src/components/stock/market-panel.tsx`：

```tsx
import React from 'react';
import { StockDetailResult } from '@workspace/api-client-react';
import { TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import type { GroupRank } from '@/lib/groupStrength';

interface MarketPanelProps {
  returns?: StockDetailResult['returns'];
  relativeStrength?: StockDetailResult['relativeStrength'];
  market?: StockDetailResult['market'];
  groupRank?: GroupRank | null;
}

const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

/**
 * 相對強弱：對大盤、對同族群。
 *
 * 少了這一塊，「上升趨勢」這個結論沒有基準 —— 大盤同期漲 15% 而個股漲 8%
 * 時畫面照樣寫上升趨勢，但它其實輸給大盤。這些數值只做顯示，不進評分。
 */
export function MarketPanel({ returns, relativeStrength, market, groupRank }: MarketPanelProps) {
  // 大盤抓不到時整塊不渲染，不顯示半截狀態
  if (!market || !relativeStrength) return null;

  const rs20 = relativeStrength.d20;
  const beating = rs20 != null && rs20 > 0;

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">相對強弱（20 日）</span>
        {market.asOf && (
          <span className="text-[11px] text-muted-foreground font-mono">大盤截至 {market.asOf}</span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground shrink-0">個股 / 大盤</span>
        <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
        <span className="font-mono text-xs text-muted-foreground">
          {pct(returns?.d20)} / {pct(market.return20d)}
        </span>
        <span
          className={`font-mono font-bold text-sm shrink-0 flex items-center gap-1 ${
            beating ? 'text-primary' : 'text-destructive'
          }`}
        >
          {beating ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {pct(rs20)}
        </span>
      </div>

      {groupRank && groupRank.total > 1 && (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">同族群排名</span>
          <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
          <span className="font-mono font-medium">
            第 {groupRank.rank} / {groupRank.total} 強
          </span>
          {groupRank.leader && <span className="text-xs text-primary shrink-0">族群最強</span>}
          {groupRank.laggard && <span className="text-xs text-destructive shrink-0">族群最弱</span>}
        </div>
      )}

      {/* 系統性風險：大盤跌破雙均線時，五檔的停損會同時被觸發 ——
          畫面上「分散五檔」看起來是保護，在這種時候並不是。 */}
      {market.maSignal === 'below_both' && (
        <div className="text-xs text-amber-500/90 bg-amber-500/10 p-2 rounded flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            大盤已跌破雙均線。此時個股停損被觸發的機率上升，且同一批標的會同時發生 ——
            分散持有在系統性下跌時不構成保護。
          </span>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        相對強弱為個股報酬減大盤同期報酬（百分點），只做顯示，不計入評分。
      </p>
    </div>
  );
}
```

- [ ] **Step 2: 掛進卡片**

在 `stock-card.tsx` 加入 import：

```tsx
import { MarketPanel } from '@/components/stock/market-panel';
import type { GroupRank } from '@/lib/groupStrength';
```

在 `StockCardProps` 加入：

```tsx
  /** 同一條供應鏈內的相對強弱排名。null 代表無可比對象 */
  groupRank?: GroupRank | null;
```

簽名改為：

```tsx
export function StockCard({ stock, detail, loading, settings, verified, groupRank }: StockCardProps) {
```

在 `detail` 的解構清單中加入三個新欄位（放在 `swingLow` 之後）：

```tsx
    returns,
    relativeStrength,
    market,
```

並在 `<ChipsPanel ... />` 之前插入：

```tsx
          <MarketPanel
            returns={returns}
            relativeStrength={relativeStrength}
            market={market}
            groupRank={groupRank}
          />
```

- [ ] **Step 3: analysis.tsx 算排名並傳入**

加入 import：

```tsx
import { rankByStrength } from '@/lib/groupStrength';
```

在 `sortedStocks` 之後加入：

```tsx
  // 族群排名用同一批已載入的明細算，不發任何請求
  const groupRanks = useMemo(
    () =>
      rankByStrength(
        Object.entries(derivedStockDetails).map(([code, d]) => ({
          code,
          return20d: d.returns?.d20 ?? null,
        })),
      ),
    [derivedStockDetails],
  );
```

並在 `<StockCard ... />` 補上 prop：

```tsx
                    groupRank={groupRanks[stock.code] ?? null}
```

- [ ] **Step 4: 全測試、型別檢查、建置**

Run: `npx vitest run && npx pnpm run typecheck && npx pnpm run build`
Expected: 全綠

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "畫面補上相對大盤與同族群排名，並在大盤跌破均線時提示系統性風險"
```

---

## 完成標準

- [ ] `npx vitest run` 全綠
- [ ] `npx pnpm run typecheck` 全綠
- [ ] `npx pnpm run build` 成功
- [ ] `stockCacheKey` 版本前綴已從 `v4` 遞增為 `v5`
- [ ] `RULE_VERSION` 仍為 3，未變動
- [ ] 大盤只在當日第一次查詢時抓取，其餘命中 `marketCacheKey()` 快取
- [ ] 大盤抓不到時 `market` 與 `relativeStrength` 為 null，MarketPanel 整塊不渲染
