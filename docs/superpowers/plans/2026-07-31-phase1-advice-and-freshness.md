# 第一階段：操作建議與資料時效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除「建議買價高於現價，現價卻低於停損價」的矛盾，並在畫面上顯示目前操作建議、資料更新時間與策略類型。

**Architecture:** 新增一層純函式 `advice.ts`，由交易計畫的價位幾何（進場區間相對於現價的位置）推出操作狀態與計畫種類，後端只回傳列舉值、畫面文字全由前端負責 —— 與現有 `evSignal` 的做法一致。同時修正 `tradePlan.ts` 追高分支「一邊說等回檔、一邊給出含現價的區間」的次要矛盾。所有會顯示的數字有變動，因此引入 `ruleVersion`，讓前瞻驗證的統計依規則版本分列。

**Tech Stack:** TypeScript 5.9（`strictNullChecks`，未開 `noUncheckedIndexedAccess`）、Express 5、React 19、Vite 7、Tailwind 4、TanStack Query 5、vitest 4、pnpm 11、Orval 8

**規格來源：** `docs/superpowers/specs/2026-07-31-stock-advice-ux-design.md`

## Global Constraints

這一節的要求隱含在每一個任務裡。

- **維持日線資料，不接即時報價。** 不得新增任何外部資料源。
- **不得新增任何外部 API 請求。** 第一階段完全使用 `stock.ts` 既有的四個 FinMind 呼叫回傳的資料。
- **不改停損公式。** `stopLoss = entryMid + BEAR_ATR_MULTIPLE × atr × factor` 維持原樣。追高分支的停損數值會變，但那是 `entryMid` 下移的結果，不是公式改了。
- **不改 `scenarioProbabilities` 的機率分段門檻**（4 / 2 / 0 / -2）。
- **不改 `bullAtrMultiple` 與 `horizonFactor`。**
- **不改 `calcScore`。** 評分改版屬第二階段。
- **不新增任何 Gemini 呼叫。**
- **所有新增的 OpenAPI 欄位一律不放進 `required`。** 舊快照不含這些欄位，設成必填會讓歷史紀錄開不起來。
- **所有價位必須經 `roundToTick`。** 未取整的價格無法下單。
- **前端每個新區塊在對應欄位缺席時整塊不渲染**，不得顯示 `-`、`undefined` 或 `NaN`。
- **註解與畫面文字一律繁體中文**，與現有程式碼一致。
- **本階段的 `ruleVersion` 為 2。**

## 常用指令

| 用途 | 指令 |
|---|---|
| 跑單一測試檔 | `pnpm exec vitest run <路徑>` |
| 跑全部測試 | `pnpm test` |
| 型別檢查（含 Netlify 函式） | `pnpm run typecheck` |
| 由 OpenAPI 重新產生前端型別 | `pnpm --filter @workspace/api-spec run codegen` |
| 建置前後端 | `pnpm run build` |
| 同源啟動（驗收用） | `pnpm run build` 然後 `PORT=5000 pnpm start`，開 <http://localhost:5000> |

## 檔案結構

| 檔案 | 職責 | 動作 |
|---|---|---|
| `artifacts/api-server/src/lib/advice.ts` | 操作建議狀態機（純函式） | 新增 |
| `artifacts/api-server/src/lib/advice.test.ts` | 上者的測試，含三個鎖住本次缺陷的案例 | 新增 |
| `artifacts/api-server/src/lib/tradePlan.ts` | 追高分支的進場上緣修正 | 修改 |
| `artifacts/api-server/src/lib/tradePlan.test.ts` | 追高修正的測試 | 修改 |
| `artifacts/api-server/src/lib/dailyCache.ts` | `stockCacheKey` 加規則版本前綴 | 修改 |
| `artifacts/api-server/src/lib/dailyCache.test.ts` | 版本前綴的測試 | 修改 |
| `lib/api-spec/openapi.yaml` | `advice`、`ruleVersion`、`chipsAsOf`、`revenueAsOf` | 修改 |
| `artifacts/api-server/src/routes/stock.ts` | 接上 `deriveAdvice`、輸出三個資料日期與 `ruleVersion` | 修改 |
| `artifacts/web/src/lib/strategy.ts` | 週期 → 策略類型標籤 | 新增 |
| `artifacts/web/src/lib/strategy.test.ts` | 上者的測試 | 新增 |
| `artifacts/web/src/components/stock/advice-banner.tsx` | 操作建議橫幅 | 新增 |
| `artifacts/web/src/components/data-freshness.tsx` | 三個資料來源的日期 | 新增 |
| `artifacts/web/src/components/stock-card.tsx` | 組裝上述元件，依 `planKind` 決定計畫區塊的標題與是否顯示 | 修改 |
| `artifacts/web/src/lib/verify.ts` | 依 `ruleVersion` 分組 | 修改 |
| `artifacts/web/src/lib/verify.test.ts` | 分組的測試 | 修改 |
| `artifacts/web/src/pages/home.tsx` | 對答案依版本分列 | 修改 |

**沒有 React 元件測試。** 本專案的 vitest `environment` 是 `node`，未安裝 jsdom 或 testing-library，現有測試全部針對純函式。元件任務的驗收方式是 `pnpm run typecheck` 加上瀏覽器實際確認 —— 不要為了測元件而引入新的測試框架。

---

### Task 1: 操作建議狀態機

這是整份計畫的核心，直接鎖住使用者回報的缺陷。

**Files:**
- Create: `artifacts/api-server/src/lib/advice.ts`
- Test: `artifacts/api-server/src/lib/advice.test.ts`

**Interfaces:**
- Consumes: 無（純函式，不依賴任何既有模組）
- Produces:
  - `type AdviceAction = "can_enter" | "wait_pullback" | "wait_breakout" | "stop_breached" | "insufficient_data"`
  - `type PlanKind = "immediate" | "pullback" | "conditional" | "none"`
  - `interface AdviceInput { currentPrice: number | null; entryLow: number | null; entryHigh: number | null; stopLoss: number | null }`
  - `interface AdviceOutput { action: AdviceAction; planKind: PlanKind }`
  - `function deriveAdvice(input: AdviceInput): AdviceOutput`

- [ ] **Step 1: 寫失敗的測試**

建立 `artifacts/api-server/src/lib/advice.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { deriveAdvice, type AdviceInput } from "./advice";

/** 站上均線、現價落在區間內的中性起點，各測試只覆寫需要的欄位 */
function input(over: Partial<AdviceInput> = {}): AdviceInput {
  return { currentPrice: 100, entryLow: 96, entryHigh: 100, stopLoss: 90, ...over };
}

describe("deriveAdvice", () => {
  it("現價落在進場區間內 → 可進場", () => {
    expect(deriveAdvice(input())).toEqual({ action: "can_enter", planKind: "immediate" });
  });

  it("缺任一價位 → 資料不足，且不輸出計畫", () => {
    for (const missing of ["currentPrice", "entryLow", "entryHigh", "stopLoss"] as const) {
      expect(deriveAdvice(input({ [missing]: null }))).toEqual({
        action: "insufficient_data",
        planKind: "none",
      });
    }
  });

  // ── 以下三個案例直接對應使用者回報的缺陷 ──────────────────────────────

  it("跌破雙均線且現價低於停損 → 不建議進場，且不輸出任何計畫", () => {
    // 使用者回報的組合：進場區被設在月線之上（高於現價 80），
    // 停損由該假設進場價往下推，結果 85 仍高於現價。
    expect(deriveAdvice(input({ currentPrice: 80, entryLow: 95, entryHigh: 96, stopLoss: 85 }))).toEqual({
      action: "stop_breached",
      planKind: "none",
    });
  });

  it("跌破雙均線但停損未破 → 等待突破，且三個價位順序一致", () => {
    const i = input({ currentPrice: 92, entryLow: 95, entryHigh: 96, stopLoss: 85 });
    expect(deriveAdvice(i)).toEqual({ action: "wait_breakout", planKind: "conditional" });

    // 這組斷言證明排序正確：停損 < 現價 < 進場下緣，語意上完全一致 ——
    // 「現在 92，等站回 95 才進場，屆時停損掛在 85」。
    // 若把「區間在現價之上」的判斷排到停損檢查之前，上一個測試的案例
    // 會誤落到這一格，而那正是畫面上出現矛盾數字的原因。
    expect(i.stopLoss!).toBeLessThan(i.currentPrice!);
    expect(i.currentPrice!).toBeLessThan(i.entryLow!);
  });

  it("進場區間在現價之下 → 等待回檔", () => {
    expect(
      deriveAdvice(input({ currentPrice: 110, entryLow: 100, entryHigh: 105, stopLoss: 90 })),
    ).toEqual({ action: "wait_pullback", planKind: "pullback" });
  });

  it("現價恰等於停損視為已跌破", () => {
    expect(deriveAdvice(input({ currentPrice: 90, stopLoss: 90 })).action).toBe("stop_breached");
  });

  it("planKind 為 none 時代表畫面不該顯示任何價位", () => {
    for (const i of [
      input({ currentPrice: null }),
      input({ currentPrice: 80, entryLow: 95, entryHigh: 96, stopLoss: 85 }),
    ]) {
      expect(deriveAdvice(i).planKind).toBe("none");
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run artifacts/api-server/src/lib/advice.test.ts`

Expected: FAIL —— `Failed to resolve import "./advice"`

- [ ] **Step 3: 寫實作**

建立 `artifacts/api-server/src/lib/advice.ts`：

```ts
/**
 * 操作建議狀態機 —— 由交易計畫的價位幾何推出「現在到底能不能買」。
 *
 * 這一層存在的理由：`entryLow`/`entryHigh` 在跌破雙均線時代表的是
 * 「**假如**站回月線之後」的進場區，而不是「現在的建議買價」。
 * 畫面若直接把它當成建議買價印出，就會同時出現「建議買價高於現價」
 * 與「現價低於停損」兩個互相矛盾的數字 —— 那不是算錯，是同一組欄位
 * 被賦予了兩種語意。把狀態獨立算出來，畫面才有辦法用正確的說法陳述它們。
 *
 * 只回傳列舉值，不回傳畫面文字 —— 與 `evSignal` 的做法一致，
 * 文案留在前端（見 `artifacts/web/src/components/stock/advice-banner.tsx`）。
 */

export type AdviceAction =
  | "can_enter"
  | "wait_pullback"
  | "wait_breakout"
  | "stop_breached"
  | "insufficient_data";

/** 進場區間相對於現價的位置 —— 決定畫面要怎麼稱呼那組價位 */
export type PlanKind =
  /** 區間含現價，可直接掛單 */
  | "immediate"
  /** 區間在現價之下，等回檔 */
  | "pullback"
  /** 區間在現價之上，計畫尚未成立 */
  | "conditional"
  /** 不該顯示任何價位 */
  | "none";

export interface AdviceInput {
  currentPrice: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
}

export interface AdviceOutput {
  action: AdviceAction;
  planKind: PlanKind;
}

export function deriveAdvice(input: AdviceInput): AdviceOutput {
  const { currentPrice, entryLow, entryHigh, stopLoss } = input;

  if (currentPrice === null || entryLow === null || entryHigh === null || stopLoss === null) {
    return { action: "insufficient_data", planKind: "none" };
  }

  // 停損檢查必須排在最前面 —— 而且要排在「區間在現價之上」之前，這與直覺相反。
  //
  // 兩個矛盾價位只在跌破雙均線的分支同時出現。若先攔截那個分支，
  // 這個狀態就永遠不可達，等於把真正要處理的案例吞掉。
  //
  // 在站上均線的分支這裡本來就不可能成立：`entryHigh <= currentPrice`，
  // 故 `entryMid <= currentPrice`，而 `stopLoss = entryMid − 2×ATR×係數 < entryMid`。
  if (currentPrice <= stopLoss) {
    return { action: "stop_breached", planKind: "none" };
  }

  // 區間在現價之上：計畫尚未成立，等突破。
  // 走到這裡必有 stopLoss < currentPrice < entryLow，三者順序一致，沒有矛盾。
  if (entryLow > currentPrice) {
    return { action: "wait_breakout", planKind: "conditional" };
  }

  // 區間在現價之下：追高了，等回檔
  if (entryHigh < currentPrice) {
    return { action: "wait_pullback", planKind: "pullback" };
  }

  return { action: "can_enter", planKind: "immediate" };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run artifacts/api-server/src/lib/advice.test.ts`

Expected: PASS，7 個測試全過

- [ ] **Step 5: 提交**

```bash
git add artifacts/api-server/src/lib/advice.ts artifacts/api-server/src/lib/advice.test.ts
git commit -m "新增操作建議狀態機，由價位幾何推出可否進場"
```

---

### Task 2: 修正追高分支的進場上緣

**Files:**
- Modify: `artifacts/api-server/src/lib/tradePlan.ts:181-187`
- Test: `artifacts/api-server/src/lib/tradePlan.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `calcEV` 的行為變更 —— 判定 `entryTiming === "wait_pullback"` 時，`entryHigh` 會低於 `currentPrice`。`EVOutput` 的型別不變。

**背景：** 現行程式在追高時把 `entryHigh` 設為 `currentPrice`，畫面於是一邊寫「等待回檔」、一邊給出上緣就是現價的區間 —— 與 Task 1 處理的是同一類矛盾的較輕版本。

- [ ] **Step 1: 寫失敗的測試**

在 `artifacts/api-server/src/lib/tradePlan.test.ts` 的 `describe("calcEV", ...)` 區塊中新增（若無該區塊，附加在檔案末尾）：

```ts
describe("追高分支的進場區間", () => {
  it("判定追高時上緣壓在現價之下 —— 否則畫面一邊說等回檔、一邊給含現價的區間", () => {
    // 現價 100、月線 85、ATR 5 → 100−85=15 > 2×5，判定追高
    const out = calcEV(input({ currentPrice: 100, ma20: 85, ma60: 80, atr: 5 }));
    expect(out.entryTiming).toBe("wait_pullback");
    expect(out.entryHigh!).toBeLessThan(100);
  });

  it("未追高時上緣仍為現價", () => {
    const out = calcEV(input({ currentPrice: 100, ma20: 95, ma60: 90, atr: 5 }));
    expect(out.entryTiming).toBe("now");
    expect(out.entryHigh).toBe(100);
  });

  it("各種波動與價位下，進場下緣都不高於上緣", () => {
    // 取整到檔位後兩端可能塌到同一格，區間仍必須是合法區間
    for (const currentPrice of [8, 45, 90, 300, 800, 1500]) {
      for (const atr of [0.05, 0.5, 3, 12]) {
        const out = calcEV(
          input({
            currentPrice,
            ma20: currentPrice - 3 * atr,
            ma60: currentPrice - 4 * atr,
            atr,
          }),
        );
        expect(out.entryTiming).toBe("wait_pullback");
        expect(out.entryLow!).toBeLessThanOrEqual(out.entryHigh!);
      }
    }
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run artifacts/api-server/src/lib/tradePlan.test.ts`

Expected: FAIL —— 第一個測試會報 `expected 100 to be less than 100`

- [ ] **Step 3: 寫實作**

在 `artifacts/api-server/src/lib/tradePlan.ts` 中，把 `else` 分支（原第 181-187 行）：

```ts
    } else {
      // 站上均線：等回檔一個 ATR 之內，且不低於 MA20。
      entryLow = roundToTick(Math.min(Math.max(ma20, currentPrice - atr), currentPrice));
      entryHigh = roundToTick(currentPrice);
      // 離月線超過兩個 ATR 視為追高。
      entryTiming = currentPrice - ma20 > 2 * atr ? "wait_pullback" : "now";
    }
```

改為：

```ts
    } else {
      // 離月線超過兩個 ATR 視為追高。
      const chasing = currentPrice - ma20 > 2 * atr;

      // 站上均線：等回檔一個 ATR 之內，且不低於 MA20。
      entryLow = roundToTick(Math.min(Math.max(ma20, currentPrice - atr), currentPrice));

      // 判定追高時上緣必須低於現價。上緣等於現價的話，畫面會一邊寫
      // 「等待回檔」、一邊給出含現價的區間 —— 使用者照著看會以為現在就能買。
      entryHigh = roundToTick(chasing ? currentPrice - 0.3 * atr : currentPrice);

      // 取整到檔位後兩端可能塌到同一格（高價股的檔位是 5 元，而 0.7×ATR
      // 可能不到半個檔位）。下緣高於上緣是無效區間，夾回來即可 ——
      // 此時區間退化成單一價位，仍低於現價，語意不變。
      if (entryHigh < entryLow) entryHigh = entryLow;

      entryTiming = chasing ? "wait_pullback" : "now";
    }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run artifacts/api-server/src/lib/tradePlan.test.ts`

Expected: PASS，且**既有測試一個都不該改**。

已逐一核對過：既有測試裡沒有任何一個同時「判定為追高」且「斷言 `entryHigh`」。
`tradePlan.test.ts:141` 斷言 `entryHigh` 為 100，但該案例是現價 100、月線 98、
ATR 10，乖離 2 不到 2×ATR＝20，不算追高；`tradePlan.test.ts:230-233`、
`tradePlan.test.ts:250-268` 用的輸入乖離也都遠小於 2×ATR。
`tradePlan.test.ts:127-132` 確實是追高案例，但它只斷言 `entryTiming`。

**若有既有測試失敗，代表實作寫錯了，不要改測試去遷就。**

- [ ] **Step 5: 跑全部測試**

Run: `pnpm test`

Expected: 全過

- [ ] **Step 6: 提交**

```bash
git add artifacts/api-server/src/lib/tradePlan.ts artifacts/api-server/src/lib/tradePlan.test.ts
git commit -m "追高時進場上緣壓低於現價，消除「等回檔卻含現價」的矛盾"
```

---

### Task 3: 快取鍵加規則版本前綴

**Files:**
- Modify: `artifacts/api-server/src/lib/dailyCache.ts:63-66`
- Test: `artifacts/api-server/src/lib/dailyCache.test.ts:66-74`

**Interfaces:**
- Consumes: 無
- Produces: `stockCacheKey(code, period)` 回傳值改變（含 `|v2|` 片段），簽章不變。

- [ ] **Step 1: 寫失敗的測試**

在 `artifacts/api-server/src/lib/dailyCache.test.ts` 的 `describe("stockCacheKey", ...)` 內新增：

```ts
  it("帶規則版本前綴 —— 部署當天不會讀到缺少新欄位的舊 payload", () => {
    expect(stockCacheKey("2330", "3m")).toContain("|v2|");
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run artifacts/api-server/src/lib/dailyCache.test.ts`

Expected: FAIL —— `expected 'stock|2330|3m' to contain '|v2|'`

- [ ] **Step 3: 寫實作**

在 `artifacts/api-server/src/lib/dailyCache.ts` 把：

```ts
/** 個股資料以「代號＋週期」為鍵 —— 不同週期算出來的交易計畫不同 */
export function stockCacheKey(code: string, period: string): string {
  return `stock|${code.trim().toLowerCase()}|${period}`;
}
```

改為：

```ts
/**
 * 個股資料以「代號＋週期」為鍵 —— 不同週期算出來的交易計畫不同。
 *
 * 版本前綴針對的是部署當天：快取雖然以日失效，但當天稍早寫入的 payload
 * 是舊版程式產生的，缺少新欄位。沒有版本前綴時，使用者會拿到少一截欄位的
 * 回應直到隔天 —— 而畫面對缺欄位的處理是整塊不渲染，看起來就像功能沒上線。
 * 改版時遞增此處的版本號即可讓舊項目自然失效。
 */
export function stockCacheKey(code: string, period: string): string {
  return `stock|v2|${code.trim().toLowerCase()}|${period}`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run artifacts/api-server/src/lib/dailyCache.test.ts`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add artifacts/api-server/src/lib/dailyCache.ts artifacts/api-server/src/lib/dailyCache.test.ts
git commit -m "個股快取鍵加規則版本前綴，避免部署當天回傳缺欄位的舊 payload"
```

---

### Task 4: OpenAPI 契約新增欄位

**Files:**
- Modify: `lib/api-spec/openapi.yaml`（`components.schemas.StockDetailResult.properties`）
- 自動產生（勿手改）：`lib/api-client-react/src/generated/*`、`lib/api-zod/src/generated/*`

**Interfaces:**
- Consumes: Task 1 的 `AdviceAction`、`PlanKind` 列舉值（此處以 OpenAPI `enum` 重複宣告，字串必須逐字一致）
- Produces: 前端型別 `StockDetailResult` 新增 `ruleVersion?: number`、`advice?: StockDetailResultAdvice`、`chipsAsOf?: string | null`、`revenueAsOf?: string | null`；並產生 `StockDetailResultAdvice`、`StockDetailResultAdviceAction`、`StockDetailResultAdvicePlanKind`

- [ ] **Step 1: 新增欄位定義**

在 `lib/api-spec/openapi.yaml` 中，`StockDetailResult` 的 `properties` 底下、`officialIndustry` 之後、`required:` 之前插入：

```yaml
        ruleVersion:
          type: integer
          description: >-
            計算規則版本。快照會存下此值，前瞻驗證的統計才不會把不同規則
            算出來的結果混進同一個達標率裡。
            1=初版（快照中沒有這個欄位者）、2=進場上緣與操作建議修正。
        advice:
          type: object
          description: >-
            由交易計畫的價位幾何推出的操作建議。只給列舉值，畫面文字由前端負責。
          properties:
            action:
              type: string
              enum: [can_enter, wait_pullback, wait_breakout, stop_breached, insufficient_data]
              description: >-
                can_enter=現價落在進場區間內、
                wait_pullback=區間在現價之下需等回檔、
                wait_breakout=區間在現價之上需等突破、
                stop_breached=現價已低於停損、
                insufficient_data=缺少必要價位
            planKind:
              type: string
              enum: [immediate, pullback, conditional, none]
              description: >-
                進場區間相對於現價的位置。
                conditional 表示區間在現價之上、計畫尚未成立，畫面必須以
                「站回月線後的計畫」而非「建議買價」陳述那組價位；
                none 表示不得顯示任何價位。
          required:
            - action
            - planKind
        chipsAsOf:
          type: string
          nullable: true
          description: 三大法人買賣超資料的最後日期（YYYY-MM-DD）
        revenueAsOf:
          type: string
          nullable: true
          description: >-
            最近一筆月營收所屬年月（YYYY/MM）。
            與股價、法人各自獨立顯示 —— 三個來源的最新日期不一定相同，
            合併成單一「更新時間」會蓋掉這個差異。
```

**不要**把任何新欄位加進 `StockDetailResult` 的 `required` 清單（該清單目前只有 `- code`，維持原樣）。

- [ ] **Step 2: 重新產生前端型別**

Run: `pnpm --filter @workspace/api-spec run codegen`

Expected: 成功，且 `lib/api-client-react/src/generated/api.schemas.ts` 出現 `StockDetailResultAdvice`

- [ ] **Step 3: 確認產生的型別**

Run: `pnpm exec grep -n "ruleVersion\|StockDetailResultAdvice\|chipsAsOf\|revenueAsOf" lib/api-client-react/src/generated/api.schemas.ts`

Expected: 四者皆出現；`advice`、`ruleVersion`、`chipsAsOf`、`revenueAsOf` 在 `StockDetailResult` 中皆為選填（欄位名後有 `?`）

- [ ] **Step 4: 型別檢查**

Run: `pnpm run typecheck`

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "契約新增 advice、ruleVersion 與各資料來源日期"
```

---

### Task 5: 後端輸出操作建議與資料日期

**Files:**
- Modify: `artifacts/api-server/src/routes/stock.ts`

**Interfaces:**
- Consumes: Task 1 的 `deriveAdvice`；Task 4 的契約欄位
- Produces: `GET /api/stock/:code` 的回應新增 `ruleVersion`、`advice`、`chipsAsOf`、`revenueAsOf`

- [ ] **Step 1: 加入 import 與版本常數**

在 `artifacts/api-server/src/routes/stock.ts` 的 import 區塊，於 `import { PERIOD_TRADING_DAYS, calcEV, horizonFactor } from "../lib/tradePlan";` 之後加入：

```ts
import { deriveAdvice } from "../lib/advice";
```

在 `const stockCache = dailyCacheFor<Record<string, unknown>>();` 之後加入：

```ts
/**
 * 計算規則版本。任何會改變畫面上顯示數字的變更都必須遞增，
 * 並同步更新 `stockCacheKey` 的版本前綴 —— 前瞻驗證靠這個值分辨
 * 每筆快照是哪一套規則算出來的。
 */
const RULE_VERSION = 2;
```

- [ ] **Step 2: 計算 advice 與三個資料日期**

在 `const trailingStop = rawTrailing === null ? null : roundToTick(rawTrailing);` 之後、`const payload = {` 之前插入：

```ts
    // 由價位幾何推出「現在能不能買」。必須在 calcEV 之後 ——
    // 它讀的是算完並取整後的進場區與停損。
    const advice = deriveAdvice({
      currentPrice,
      entryLow: ev.entryLow,
      entryHigh: ev.entryHigh,
      stopLoss: ev.stopLoss,
    });

    // 三個來源各自標日期。FinMind 的法人資料與股價未必同步更新，
    // 合成一個「更新時間」會把這個差異蓋掉。
    const chipsAsOf = institutionals.reduce<string | null>(
      (latest, row) => (latest === null || row.date > latest ? row.date : latest),
      null,
    );
```

- [ ] **Step 3: 加進 payload**

在 `artifacts/api-server/src/routes/stock.ts` 的 `payload` 物件中，把：

```ts
      priceAsOf,
      stockName: info?.stock_name ?? null,
```

改為：

```ts
      priceAsOf,
      chipsAsOf,
      revenueAsOf: revenueHistory[0]?.yearMonth ?? null,
      ruleVersion: RULE_VERSION,
      advice,
      stockName: info?.stock_name ?? null,
```

- [ ] **Step 4: 型別檢查**

Run: `pnpm run typecheck`

Expected: PASS

- [ ] **Step 5: 跑全部測試**

Run: `pnpm test`

Expected: 全過

- [ ] **Step 6: 提交**

```bash
git add artifacts/api-server/src/routes/stock.ts
git commit -m "個股回應加上操作建議、各來源資料日期與規則版本"
```

---

### Task 6: 策略類型標籤

**Files:**
- Create: `artifacts/web/src/lib/strategy.ts`
- Test: `artifacts/web/src/lib/strategy.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `interface Strategy { label: string; detail: string }`、`function strategyFor(period?: string | null): Strategy`

- [ ] **Step 1: 寫失敗的測試**

建立 `artifacts/web/src/lib/strategy.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { strategyFor } from './strategy';

describe('strategyFor', () => {
  it('三個週期各自對應一種操作策略', () => {
    expect(strategyFor('1m').label).toBe('短線');
    expect(strategyFor('3m').label).toBe('波段');
    expect(strategyFor('6m').label).toBe('中長線');
  });

  it('附上持有期間，避免只有標籤看不出尺度', () => {
    expect(strategyFor('6m').detail).toContain('6');
  });

  it('週期缺失或不在規格內時退回基準週期，與後端 normalizePeriod 一致', () => {
    expect(strategyFor(undefined)).toEqual(strategyFor('3m'));
    expect(strategyFor(null)).toEqual(strategyFor('3m'));
    expect(strategyFor('99y')).toEqual(strategyFor('3m'));
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run artifacts/web/src/lib/strategy.test.ts`

Expected: FAIL —— `Failed to resolve import "./strategy"`

- [ ] **Step 3: 寫實作**

建立 `artifacts/web/src/lib/strategy.ts`：

```ts
/**
 * 分析週期對應的操作策略類型。
 *
 * 週期在後端已透過 `horizonFactor` 影響停損停利的絕對幅度，這裡只是把
 * 同一個選擇翻成使用者看得懂的說法 —— 少了它，抱 6 個月的計畫會被
 * 當成隔日沖用，而畫面上沒有任何地方點出這個差別。
 */

export interface Strategy {
  /** 策略名稱，例如「波段」 */
  label: string;
  /** 約當持有期間，例如「約 3 個月」 */
  detail: string;
}

const STRATEGIES: Record<string, Strategy> = {
  '1m': { label: '短線', detail: '約 1 個月' },
  '3m': { label: '波段', detail: '約 3 個月' },
  '6m': { label: '中長線', detail: '約 6 個月' },
};

/** 基準週期，與後端 `normalizePeriod` 的預設一致 */
const DEFAULT: Strategy = { label: '波段', detail: '約 3 個月' };

/** 週期缺失或不在規格內時一律以基準週期陳述，不顯示空白標籤 */
export function strategyFor(period?: string | null): Strategy {
  return STRATEGIES[period ?? ''] ?? DEFAULT;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run artifacts/web/src/lib/strategy.test.ts`

Expected: PASS，3 個測試全過

- [ ] **Step 5: 提交**

```bash
git add artifacts/web/src/lib/strategy.ts artifacts/web/src/lib/strategy.test.ts
git commit -m "新增分析週期對應的操作策略類型"
```

---

### Task 7: 操作建議橫幅元件

**Files:**
- Create: `artifacts/web/src/components/stock/advice-banner.tsx`

**Interfaces:**
- Consumes: Task 4 產生的 `StockDetailResult['advice']`
- Produces: `export function AdviceBanner(props: AdviceBannerProps)`，其中
  `interface AdviceBannerProps { advice?: StockDetailResult['advice']; currentPrice?: number | null; entryLow?: number | null; entryHigh?: number | null; stopLoss?: number | null; priceAsOf?: string | null }`

**注意：** 本專案沒有 React 元件測試環境（vitest `environment: 'node'`，未裝 jsdom）。驗收靠型別檢查與瀏覽器實測，**不要為此引入新的測試框架**。

- [ ] **Step 1: 建立元件**

建立 `artifacts/web/src/components/stock/advice-banner.tsx`：

```tsx
import React from 'react';
import { StockDetailResult } from '@workspace/api-client-react';
import { CheckCircle2, Clock, XCircle, HelpCircle } from 'lucide-react';

interface AdviceBannerProps {
  advice?: StockDetailResult['advice'];
  currentPrice?: number | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss?: number | null;
  priceAsOf?: string | null;
}

/**
 * 目前操作建議。
 *
 * 這是整張卡片最先該被看到的東西 —— 交易計畫的三個價位在跌破均線時
 * 講的是「假如站回月線之後」，沒有這條橫幅，使用者只會看到三個
 * 彼此打架的數字而不知道現在到底能不能買。
 */
export function AdviceBanner({
  advice,
  currentPrice,
  entryLow,
  entryHigh,
  stopLoss,
  priceAsOf,
}: AdviceBannerProps) {
  // 舊快照沒有這個欄位 —— 整塊不渲染，不顯示半截狀態
  if (!advice) return null;

  const price = currentPrice != null ? currentPrice.toString() : '—';

  const view = {
    can_enter: {
      Icon: CheckCircle2,
      title: '可進場',
      body: `現價 ${price} 落在建議區間 ${entryLow} ~ ${entryHigh} 之間`,
      className: 'bg-primary/10 border-primary/40 text-primary',
    },
    wait_pullback: {
      Icon: Clock,
      title: '等待回檔買點',
      body: `現價 ${price} 已離月線過遠，等回檔至 ${entryLow} ~ ${entryHigh} 再進場`,
      className: 'bg-amber-500/10 border-amber-500/40 text-amber-500',
    },
    wait_breakout: {
      Icon: Clock,
      title: '等待突破買點',
      body: `現價 ${price}，站回 ${entryLow} 之上這份計畫才成立`,
      className: 'bg-amber-500/10 border-amber-500/40 text-amber-500',
    },
    stop_breached: {
      Icon: XCircle,
      title: '已跌破停損，不建議進場',
      body: `現價 ${price} 已低於停損 ${stopLoss}，原計畫的前提不成立`,
      className: 'bg-destructive/10 border-destructive/40 text-destructive',
    },
    insufficient_data: {
      Icon: HelpCircle,
      title: '資料不足，無法給出建議',
      body: '缺少計算交易計畫所需的價格或波動資料',
      className: 'bg-muted border-border text-muted-foreground',
    },
  }[advice.action];

  const { Icon, title, body, className } = view;

  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${className}`}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        <div className="font-bold">{title}</div>
        <div className="text-sm text-foreground/80 break-words">{body}</div>
        {priceAsOf && (
          <div className="text-xs text-muted-foreground">
            以 {priceAsOf} 收盤價判斷，非盤中即時報價
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 型別檢查**

Run: `pnpm run typecheck`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add artifacts/web/src/components/stock/advice-banner.tsx
git commit -m "新增操作建議橫幅元件"
```

---

### Task 8: 資料時效元件

**Files:**
- Create: `artifacts/web/src/components/data-freshness.tsx`

**Interfaces:**
- Consumes: Task 4 的 `chipsAsOf`、`revenueAsOf` 欄位
- Produces: `export function DataFreshness(props: { priceAsOf?: string | null; chipsAsOf?: string | null; revenueAsOf?: string | null })`

- [ ] **Step 1: 建立元件**

建立 `artifacts/web/src/components/data-freshness.tsx`：

```tsx
import React from 'react';
import { Clock3 } from 'lucide-react';

interface DataFreshnessProps {
  priceAsOf?: string | null;
  chipsAsOf?: string | null;
  revenueAsOf?: string | null;
}

/**
 * 三個資料來源各自的最新日期。
 *
 * 刻意不合成單一「更新時間」：股價、法人與月營收的更新節奏不同
 * （月營收甚至差到一個月），一個數字會讓使用者以為全部都是最新的。
 * 日線本身還延遲一天，所以這裡標的是資料日期，不是查詢時間。
 */
export function DataFreshness({ priceAsOf, chipsAsOf, revenueAsOf }: DataFreshnessProps) {
  const sources = [
    { label: '股價', value: priceAsOf },
    { label: '法人', value: chipsAsOf },
    { label: '營收', value: revenueAsOf },
  ].filter((s) => Boolean(s.value));

  // 一個來源的日期都沒有時整塊不渲染，不顯示空殼
  if (sources.length === 0) return null;

  return (
    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Clock3 className="w-3 h-3" /> 資料日期
      </span>
      {sources.map((s) => (
        <span key={s.label} className="font-mono">
          {s.label} {s.value}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 型別檢查**

Run: `pnpm run typecheck`

Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add artifacts/web/src/components/data-freshness.tsx
git commit -m "新增各資料來源日期的顯示元件"
```

---

### Task 9: 個股卡片組裝

這一步才讓使用者真的看到修正結果。

**Files:**
- Modify: `artifacts/web/src/components/stock-card.tsx`

**Interfaces:**
- Consumes: Task 6 的 `strategyFor`、Task 7 的 `AdviceBanner`、Task 8 的 `DataFreshness`、Task 4 的契約欄位
- Produces: 無（畫面組裝，不對外提供介面）

- [ ] **Step 1: 加入 import**

在 `artifacts/web/src/components/stock-card.tsx` 的 import 區塊加入：

```tsx
import { AdviceBanner } from '@/components/stock/advice-banner';
import { DataFreshness } from '@/components/data-freshness';
import { strategyFor } from '@/lib/strategy';
```

- [ ] **Step 2: 從 detail 取出新欄位**

把解構區塊（原第 25-48 行）中的 `trustNet30d,` 之後、`} = detail;` 之前加入：

```tsx
    advice,
    currentPrice,
    priceAsOf,
    chipsAsOf,
    revenueAsOf,
    period,
```

- [ ] **Step 3: 在卡片標頭加入策略類型與資料日期**

把標頭區塊中的：

```tsx
            <p className="text-sm text-muted-foreground">{stock.reason}</p>
```

改為：

```tsx
            <p className="text-sm text-muted-foreground">{stock.reason}</p>
            <div className="mt-2 space-y-1">
              <span className="inline-block px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded border border-border">
                {strategyFor(period).label} · {strategyFor(period).detail}
              </span>
              <DataFreshness
                priceAsOf={priceAsOf}
                chipsAsOf={chipsAsOf}
                revenueAsOf={revenueAsOf}
              />
            </div>
```

- [ ] **Step 4: 交易計畫區塊改為依 planKind 呈現**

把交易計畫區塊的標題與條件式（原第 147-152 行）：

```tsx
      <div className="p-5 bg-background/50 flex-1">
        <h4 className="text-sm font-bold text-muted-foreground mb-4 flex items-center gap-2">
          <Target className="w-4 h-4" /> 交易計畫
        </h4>
        
        {entryLow && entryHigh && stopLoss && takeProfit ? (
```

改為：

```tsx
      <div className="p-5 bg-background/50 flex-1 space-y-4">
        <AdviceBanner
          advice={advice}
          currentPrice={currentPrice}
          entryLow={entryLow}
          entryHigh={entryHigh}
          stopLoss={stopLoss}
          priceAsOf={priceAsOf}
        />

        <h4 className="text-sm font-bold text-muted-foreground flex items-center gap-2">
          <Target className="w-4 h-4" />
          {/* 區間在現價之上時那組價位講的是「假如站回月線之後」，
              沿用「交易計畫」這個標題就是使用者看到矛盾數字的原因 */}
          {advice?.planKind === 'conditional' ? '站回月線後的計畫（尚未成立）' : '交易計畫'}
        </h4>

        {/* planKind 為 none 代表現價已跌破停損或資料不足 —— 那組價位的前提
            已經不存在，印出來只會誤導，整塊不顯示 */}
        {advice?.planKind === 'none' ? (
          <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            目前不提供進場區間與停損停利
          </div>
        ) : entryLow && entryHigh && stopLoss && takeProfit ? (
```

- [ ] **Step 5: 把進場區間的標籤改為隨 planKind 變動**

把價位格線中的：

```tsx
                <div className="text-xs text-muted-foreground mb-1">進場區間</div>
```

改為：

```tsx
                <div className="text-xs text-muted-foreground mb-1">
                  {advice?.planKind === 'conditional' ? '成立後進場區' : '進場區間'}
                </div>
```

- [ ] **Step 6: 型別檢查**

Run: `pnpm run typecheck`

Expected: PASS

- [ ] **Step 7: 建置並實際確認**

```bash
pnpm run build
PORT=5000 pnpm start
```

開 <http://localhost:5000>，查一個關鍵字（例如「CoWoS封裝」），確認：
1. 每張卡片頂端有策略類型標籤與三個資料日期
2. 交易計畫上方有操作建議橫幅
3. 若有跌破均線的個股，其標題為「站回月線後的計畫（尚未成立）」
4. 畫面上不出現 `undefined`、`NaN` 或 `-` 佔位

按 Ctrl+C 結束。

- [ ] **Step 8: 提交**

```bash
git add artifacts/web/src/components/stock-card.tsx
git commit -m "個股卡片顯示操作建議、資料日期與策略類型"
```

---

### Task 10: 前瞻驗證依規則版本分列

**Files:**
- Modify: `artifacts/web/src/lib/verify.ts`
- Test: `artifacts/web/src/lib/verify.test.ts`
- Modify: `artifacts/web/src/pages/home.tsx:26-57`、`artifacts/web/src/pages/home.tsx:208-231`

**Interfaces:**
- Consumes: Task 4 的 `ruleVersion` 欄位
- Produces:
  - `const LEGACY_RULE_VERSION = 1`
  - `interface VersionedItem { item: VerifyOutcomeItem; ruleVersion: number }`
  - `interface VerifyGroup { ruleVersion: number; items: VerifyOutcomeItem[] }`
  - `function versionedItemsFromSnapshot(snapshot: AnalysisSnapshot): VersionedItem[]`
  - `function buildVerifyGroups(index: HistoryMeta[], now?: number): Promise<VerifyGroup[]>`
  - 既有的 `itemsFromSnapshot` 與 `buildVerifyItems` 簽章不變

- [ ] **Step 1: 寫失敗的測試**

`artifacts/web/src/lib/verify.test.ts` **沒有** mock `loadSnapshot` ——
它用的是 `test/localStorageStub` 這個真實的 localStorage 替身，
透過 `save(snapshot)` 寫進去再讀回來，且 `beforeEach` 會重置。
沿用該檔開頭既有的 `snapshot()` 工廠與 `DAY` 常數。

先把 import 那一行改為：

```ts
import {
  LEGACY_RULE_VERSION,
  buildVerifyGroups,
  buildVerifyItems,
  isRipe,
  itemsFromSnapshot,
  toDateKey,
} from './verify';
```

再於檔案末尾新增：

```ts
describe('buildVerifyGroups', () => {
  const now = new Date(2026, 6, 20).getTime();

  /** 同一份快照裡兩檔標的分屬不同規則版本 —— 用來確認分組看的是每一筆而非整份快照 */
  function mixedSnapshot() {
    const s = snapshot({ id: 'mixed', createdAt: now - 30 * DAY });
    s.stockDetails['3363'] = { ...s.stockDetails['3363'], ruleVersion: 2 };
    // 3081 刻意不給 ruleVersion，代表規則第一版留下的舊資料
    return s;
  }

  it('依規則版本分組，新版排在前面', async () => {
    const index = await save(mixedSnapshot());
    const groups = await buildVerifyGroups(index, now);
    expect(groups.map((g) => g.ruleVersion)).toEqual([2, 1]);
  });

  it('沒有 ruleVersion 的舊快照視為初版', async () => {
    const index = await save(snapshot({ id: 'legacy', createdAt: now - 30 * DAY }));
    const groups = await buildVerifyGroups(index, now);
    expect(groups).toHaveLength(1);
    expect(groups[0].ruleVersion).toBe(LEGACY_RULE_VERSION);
    expect(groups[0].items).toHaveLength(2);
  });

  it('分組後的總筆數與不分組時相同 —— 不得漏掉任何一筆', async () => {
    const index = await save(mixedSnapshot());
    const flat = await buildVerifyItems(index, now);
    const groups = await buildVerifyGroups(index, now);
    expect(groups.reduce((sum, g) => sum + g.items.length, 0)).toBe(flat.length);
  });

  it('同樣只取夠舊的快照', async () => {
    await save(mixedSnapshot());
    const index = await save(snapshot({ id: 'fresh', createdAt: now - 1 * DAY }));
    const groups = await buildVerifyGroups(index, now);
    // fresh 那兩筆不夠舊，只剩 mixed 的兩筆分成兩組
    expect(groups.reduce((sum, g) => sum + g.items.length, 0)).toBe(2);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run artifacts/web/src/lib/verify.test.ts`

Expected: FAIL —— `buildVerifyGroups is not a function`

- [ ] **Step 3: 寫實作**

在 `artifacts/web/src/lib/verify.ts` 中，把現有的 `itemsFromSnapshot`：

```ts
export function itemsFromSnapshot(snapshot: AnalysisSnapshot): VerifyOutcomeItem[] {
  const from = toDateKey(snapshot.createdAt);
  const items: VerifyOutcomeItem[] = [];

  for (const stock of snapshot.analysis.stocks) {
    const d = snapshot.stockDetails[stock.code];
    if (!d) continue;
    const { entryLow, entryHigh, stopLoss, takeProfit } = d;
    if (entryLow == null || entryHigh == null || stopLoss == null || takeProfit == null) continue;
    items.push({ code: stock.code, from, entryLow, entryHigh, stopLoss, takeProfit });
  }

  return items;
}
```

改為：

```ts
/** 快照裡沒有 ruleVersion 欄位者，是規則第一版留下的 */
export const LEGACY_RULE_VERSION = 1;

export interface VersionedItem {
  item: VerifyOutcomeItem;
  ruleVersion: number;
}

export interface VerifyGroup {
  ruleVersion: number;
  items: VerifyOutcomeItem[];
}

/**
 * 從單一快照取出可驗證的計畫，並保留各筆是哪一套規則算出來的。
 *
 * 缺少任一價位就跳過 —— 當初就沒有完整計畫的標的，事後無從驗證，
 * 硬要補一個推估價位等於偽造當時的判斷。
 */
export function versionedItemsFromSnapshot(snapshot: AnalysisSnapshot): VersionedItem[] {
  const from = toDateKey(snapshot.createdAt);
  const items: VersionedItem[] = [];

  for (const stock of snapshot.analysis.stocks) {
    const d = snapshot.stockDetails[stock.code];
    if (!d) continue;
    const { entryLow, entryHigh, stopLoss, takeProfit } = d;
    if (entryLow == null || entryHigh == null || stopLoss == null || takeProfit == null) continue;
    items.push({
      item: { code: stock.code, from, entryLow, entryHigh, stopLoss, takeProfit },
      ruleVersion: d.ruleVersion ?? LEGACY_RULE_VERSION,
    });
  }

  return items;
}

/** 不需要區分版本時的既有介面 */
export function itemsFromSnapshot(snapshot: AnalysisSnapshot): VerifyOutcomeItem[] {
  return versionedItemsFromSnapshot(snapshot).map((v) => v.item);
}
```

接著在 `buildVerifyItems` 之後新增：

```ts
/**
 * 讀取所有夠舊的快照，依規則版本分組。
 *
 * 分組的理由：規則改版會改變進場區與停損停利，兩套規則的結果混進同一個
 * 達標率之後，數字看起來仍然正常，卻已經量不到任何一套規則的真實表現。
 */
export async function buildVerifyGroups(
  index: HistoryMeta[],
  now: number = Date.now(),
): Promise<VerifyGroup[]> {
  const ripe = index.filter((entry) => isRipe(entry.createdAt, now));
  const snapshots = await Promise.all(ripe.map((entry) => loadSnapshot(entry.id)));

  const byVersion = new Map<number, VerifyOutcomeItem[]>();
  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    for (const { item, ruleVersion } of versionedItemsFromSnapshot(snapshot)) {
      const list = byVersion.get(ruleVersion) ?? [];
      list.push(item);
      byVersion.set(ruleVersion, list);
    }
  }

  return [...byVersion.entries()]
    .map(([ruleVersion, items]) => ({ ruleVersion, items }))
    .sort((a, b) => b.ruleVersion - a.ruleVersion);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run artifacts/web/src/lib/verify.test.ts`

Expected: PASS —— 新增的 3 個測試通過，既有測試全部仍過

- [ ] **Step 5: home.tsx 改為逐版本驗證**

把 `artifacts/web/src/pages/home.tsx` 的 import：

```tsx
import { buildVerifyItems, OUTCOME_LABEL } from '@/lib/verify';
```

改為：

```tsx
import { buildVerifyGroups } from '@/lib/verify';
```

把狀態與 `handleVerify`（原第 28-57 行）：

```tsx
  const [verifyResult, setVerifyResult] = useState<any>(null);
```

改為：

```tsx
  type VerifySummary = { ruleVersion: number; tally: VerifyOutcomesResult['tally'] };
  const [verifyResults, setVerifyResults] = useState<VerifySummary[] | null>(null);
```

並在 import 區塊補上型別：

```tsx
import { AnalyzeRequestPeriod, useVerifyOutcomes, VerifyOutcomesResult } from '@workspace/api-client-react';
```

把 `handleVerify` 改為：

```tsx
  const handleVerify = async () => {
    try {
      const groups = await buildVerifyGroups(history);
      if (groups.length === 0) {
        alert('目前沒有足夠時間（> 5天）的歷史紀錄可供驗證。');
        return;
      }
      // 逐版本各打一次 —— 後端一次最多收 40 筆，而不同規則算出來的計畫
      // 合併統計會得到一個量不到任何東西的達標率
      const summaries = await Promise.all(
        groups.map(async (g) => ({
          ruleVersion: g.ruleVersion,
          tally: (await verifyOutcomes.mutateAsync({ data: { items: g.items } })).tally,
        })),
      );
      setVerifyResults(summaries);
    } catch (err) {
      console.error(err);
      alert('驗證失敗，請稍後再試。');
    }
  };
```

- [ ] **Step 6: home.tsx 改為分版本呈現結果**

把結果區塊（原第 208-231 行）：

```tsx
            {verifyResult && (
              <div className="mt-6 space-y-4 p-4 bg-background rounded-xl border border-border">
                <div className="flex justify-between items-center pb-2 border-b border-border">
                  <span className="text-muted-foreground">達標率</span>
                  <span className="text-2xl font-bold text-primary">
                    {verifyResult.tally.targetRate != null ? `${(verifyResult.tally.targetRate * 100).toFixed(1)}%` : 'N/A'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="bg-muted rounded p-2">
                    <div className="text-primary font-bold">{verifyResult.tally.target}</div>
                    <div className="text-muted-foreground text-xs mt-1">達標</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-destructive font-bold">{verifyResult.tally.stop}</div>
                    <div className="text-muted-foreground text-xs mt-1">停損</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-foreground font-bold">{verifyResult.tally.open}</div>
                    <div className="text-muted-foreground text-xs mt-1">仍持有</div>
                  </div>
                </div>
              </div>
            )}
```

改為：

```tsx
            {verifyResults?.map(({ ruleVersion, tally }) => (
              <div
                key={ruleVersion}
                className="mt-6 space-y-4 p-4 bg-background rounded-xl border border-border"
              >
                <div className="flex justify-between items-center pb-2 border-b border-border">
                  <div>
                    <span className="text-muted-foreground">達標率</span>
                    <span className="ml-2 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                      規則 v{ruleVersion}
                    </span>
                  </div>
                  <span className="text-2xl font-bold text-primary">
                    {/* targetRate 後端已經是百分比（3/4 回 75），不可再乘 100 */}
                    {tally.targetRate != null ? `${tally.targetRate.toFixed(1)}%` : '尚無結論'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="bg-muted rounded p-2">
                    <div className="text-primary font-bold">{tally.target}</div>
                    <div className="text-muted-foreground text-xs mt-1">達標</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-destructive font-bold">{tally.stop}</div>
                    <div className="text-muted-foreground text-xs mt-1">停損</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-foreground font-bold">{tally.open}</div>
                    <div className="text-muted-foreground text-xs mt-1">仍持有</div>
                  </div>
                </div>
              </div>
            ))}
```

**注意這裡順手修掉一個既有缺陷：** `targetRate` 後端回傳的已經是百分比（見 `outcome.ts` 的 `tallyOutcomes`，3/4 回傳 `75`），原本的 `* 100` 會把 75% 顯示成 `7500.0%`。既然整塊重寫，不該把它留著。

- [ ] **Step 7: 型別檢查**

Run: `pnpm run typecheck`

Expected: PASS。若 `OUTCOME_LABEL` 因為移除 import 而變成未使用的匯出，保留它 —— `verify.ts` 仍匯出該常數，後續階段的明細列表會用到。

- [ ] **Step 8: 跑全部測試**

Run: `pnpm test`

Expected: 全過

- [ ] **Step 9: 提交**

```bash
git add artifacts/web/src/lib/verify.ts artifacts/web/src/lib/verify.test.ts artifacts/web/src/pages/home.tsx
git commit -m "前瞻驗證依規則版本分列，並修正達標率誤乘 100"
```

---

### Task 11: 全域驗收

**Files:** 無（僅驗證）

- [ ] **Step 1: 全部測試**

Run: `pnpm test`

Expected: 全過

- [ ] **Step 2: 型別檢查（含 Netlify 函式）**

Run: `pnpm run typecheck`

Expected: PASS

- [ ] **Step 3: 建置**

Run: `pnpm run build`

Expected: 成功

- [ ] **Step 4: 同源實測**

```bash
PORT=5000 pnpm start
```

開 <http://localhost:5000>，逐項確認第一階段的四個需求：

| 需求 | 確認點 |
|---|---|
| 1 邏輯矛盾 | 找一檔跌破均線的個股，確認標題為「站回月線後的計畫（尚未成立）」；若現價已低於停損，確認完全不顯示進場區與停損停利 |
| 2 操作建議 | 每張卡片的交易計畫上方都有一條狀態橫幅 |
| 5 更新時間 | 卡片標頭顯示股價／法人／營收各自的日期 |
| 10 策略類型 | 卡片標頭顯示短線／波段／中長線標籤 |

按 Ctrl+C 結束。

- [ ] **Step 5: 更新 README 的檔案位置表**

在 `README.md` 的「檔案位置」表格中，於「指標計算」那一列之後加入：

```markdown
| 操作建議狀態機 | `artifacts/api-server/src/lib/advice.ts` |
```

- [ ] **Step 6: 提交**

```bash
git add README.md
git commit -m "README 補上操作建議模組的位置"
```

## 自我檢查結果

**規格涵蓋：** 第一階段的四個項目皆有對應任務 —— 項目 1（Task 1、2、9）、項目 2（Task 1、7、9）、項目 5（Task 5、8、9）、項目 10（Task 6、9）。規格「規則版本」一節由 Task 3、5、10 涵蓋。規格中 `invalidation`（項目 11）屬第三階段，本計畫刻意不實作 —— `advice.ts` 屆時擴充即可。

**型別一致性：** `deriveAdvice` 的 `AdviceInput` 四個欄位（Task 1）與 `stock.ts` 的呼叫（Task 5）相符；`AdviceAction`／`PlanKind` 的字串在 Task 1 的 TypeScript 與 Task 4 的 OpenAPI `enum` 中逐字一致；`buildVerifyGroups` 的回傳型別（Task 10 Step 3）與 `home.tsx` 的消費方式（Task 10 Step 5）相符。

**已知的順帶修正：** Task 10 修掉 `targetRate` 誤乘 100 的既有缺陷（後端 `tallyOutcomes` 回傳 `75` 代表 75%，前端卻再乘 100 顯示成 `7500.0%`）。這不在原始需求內，但該區塊本來就要整段重寫，留著等於明知有錯而不改。

**已對照過真實檔案的假設：**
- `tradePlan.test.ts` 既有測試中，沒有任何一個同時判定追高又斷言 `entryHigh`，因此 Task 2 不需改動既有測試。
- `verify.test.ts` 用的是 `test/localStorageStub` 加 `save()`，不是 `loadSnapshot` 的 mock；Task 10 的測試碼已依此撰寫。
- `StockDetailResult` 目前只有 `code` 是必填，因此 `verify.test.ts` 的 fixture 可以只給部分欄位，加上 `ruleVersion` 也不會破型別。
- 單檔測試指令 `pnpm exec vitest run <路徑>` 已實際執行驗證過。
