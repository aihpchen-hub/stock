# 誠實度修正與前瞻驗證 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓畫面上已經存在的數字不再誤導 —— 補上報價延遲的真實天數、把被交易成本翻面的賠率講清楚、並讓唯一能驗證那張未經回測機率表的功能真正被看見。

**Architecture:** 三條互相獨立的線。(1) 兩個純顯示層修正，抽出可測的純函式再接進元件。(2) `OutcomeTally` 補上「成立率」—— 現有的達標率分母排除了未進場的計畫，那個排除在統計上正確，但畫面沒有把被排除的數量講出來。(3) 驗證結果從 `useState` 改存 localStorage，於是能自動觸發，也能帶到分析頁的 E(V) 旁邊 —— 宣稱與檢驗必須放在一起。

**Tech Stack:** TypeScript 5.9、React 19、Vitest 4、Express 5、OpenAPI + Orval（`lib/api-spec/openapi.yaml` 是唯一真實來源）

## Global Constraints

- **直接在 `main` 上工作**，不開功能分支。提交與上線是兩件事。
- **不動 `RULE_VERSION`。** 本計畫不改變任何評分規則或交易計畫價位，只改顯示與統計呈現。動了它會讓既有的前瞻驗證紀錄被分到新組別，等於把已累積的樣本作廢。
- **契約變更一律先改 `lib/api-spec/openapi.yaml`**，再跑 `pnpm --filter @workspace/api-spec run codegen` 產生前端 hooks 與 zod schema。手改產生物會在下次 codegen 被蓋掉。
- **舊 localStorage 快照沒有執行期驗證。** 新欄位一律以「缺值就整塊不渲染」處理，不顯示半截狀態，不丟例外 —— 整個 app 沒有 ErrorBoundary。
- **測試描述用繁體中文寫「為什麼」**，不只寫「做什麼」。既有測試（如 `strategy.test.ts`）是這個風格。
- 每個 Task 結束前必須跑過 `pnpm test` 與 `pnpm run typecheck`，兩者皆綠才提交。
- 測試不呼叫任何外部 API。時鐘一律由參數注入（`now: Date`），不在函式內讀 `Date.now()`。

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `artifacts/web/src/lib/staleness.ts` | 報價新鮮度純函式 | 建立 |
| `artifacts/web/src/lib/staleness.test.ts` | 同上測試 | 建立 |
| `artifacts/web/src/components/stock/advice-banner.tsx` | 操作建議橫幅，延遲警示升級 | 修改 |
| `artifacts/web/src/components/stock-card.tsx` | 毛值風報比降級、達標率注入 | 修改 |
| `artifacts/api-server/src/lib/outcome.ts` | 前瞻驗證判定與彙總，補成立率 | 修改 |
| `artifacts/api-server/src/lib/outcome.test.ts` | 同上測試 | 修改 |
| `lib/api-spec/openapi.yaml` | `OutcomeTally` 補兩個欄位 | 修改 |
| `artifacts/web/src/lib/verify.ts` | `isRipe` 改為隨週期調整 | 修改 |
| `artifacts/web/src/lib/verify.test.ts` | 同上測試 | 修改 |
| `artifacts/web/src/lib/verifyStore.ts` | 驗證結果的 localStorage 存取 | 建立 |
| `artifacts/web/src/lib/verifyStore.test.ts` | 同上測試 | 建立 |
| `artifacts/web/src/pages/home.tsx` | 五格顯示、成立率、自動驗證 | 修改 |
| `artifacts/web/src/pages/analysis.tsx` | 把達標率傳進卡片 | 修改 |

---

### Task 1: 報價新鮮度純函式

**Files:**
- Create: `artifacts/web/src/lib/staleness.ts`
- Test: `artifacts/web/src/lib/staleness.test.ts`

**Interfaces:**
- Consumes: 無
- Produces: `priceStaleness(priceAsOf: string | null | undefined, now: Date): Staleness | null`，`interface Staleness { days: number; stale: boolean }`

- [ ] **Step 1: 寫失敗的測試**

建立 `artifacts/web/src/lib/staleness.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { priceStaleness } from './staleness';

describe('priceStaleness', () => {
  it('算出資料日期距今幾個日曆日，使用者不必自己換算', () => {
    expect(priceStaleness('2026-08-03', new Date('2026-08-04T09:00:00'))?.days).toBe(1);
  });

  it('連假之後差距會拉大，而那正是最需要警示的情況', () => {
    expect(priceStaleness('2026-07-31', new Date('2026-08-04T09:00:00'))?.days).toBe(4);
  });

  it('同一天的資料不算過期', () => {
    const s = priceStaleness('2026-08-04', new Date('2026-08-04T15:00:00'));
    expect(s?.days).toBe(0);
    expect(s?.stale).toBe(false);
  });

  it('隔一天就算過期 —— 收盤價不能拿來當今天的掛單依據', () => {
    expect(priceStaleness('2026-08-03', new Date('2026-08-04T09:00:00'))?.stale).toBe(true);
  });

  it('跨月與跨年都以日曆日計算，不受月份長度影響', () => {
    expect(priceStaleness('2025-12-30', new Date('2026-01-02T09:00:00'))?.days).toBe(3);
  });

  it('不受時分秒影響 —— 同一天的早上與收盤後算出來一樣', () => {
    expect(priceStaleness('2026-08-01', new Date('2026-08-04T00:05:00'))?.days).toBe(3);
    expect(priceStaleness('2026-08-01', new Date('2026-08-04T23:55:00'))?.days).toBe(3);
  });

  it('缺日期或格式不合時回 null，讓畫面整塊不渲染而不是顯示 NaN', () => {
    expect(priceStaleness(null, new Date('2026-08-04'))).toBeNull();
    expect(priceStaleness(undefined, new Date('2026-08-04'))).toBeNull();
    expect(priceStaleness('not-a-date', new Date('2026-08-04'))).toBeNull();
  });

  it('資料日期在未來時回 null —— 那代表資料有問題，不該算成負天數印出來', () => {
    expect(priceStaleness('2026-08-10', new Date('2026-08-04'))).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run artifacts/web/src/lib/staleness.test.ts`
Expected: FAIL，訊息為找不到模組 `./staleness`

- [ ] **Step 3: 寫最小實作**

建立 `artifacts/web/src/lib/staleness.ts`：

```ts
/**
 * 報價新鮮度。
 *
 * 畫面先前只印「以 MM/DD 收盤價判斷」，使用者得自己換算那是幾天前 ——
 * 而連假之後那個差距可能是四天。把天數算出來，警示的強度才對得上實際風險：
 * 照著四天前的收盤價掛單，與照著昨天的掛單，是兩種不同程度的錯誤。
 *
 * 不在函式內讀時鐘，`now` 由呼叫端傳入 —— 否則測不了跨連假與跨年的情況。
 */

export interface Staleness {
  /** 距離資料日期的日曆天數 */
  days: number;
  /** 是否該用警示色。隔一天就是 —— 收盤價不能當今天的掛單依據 */
  stale: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 取當地時區的當日零點，讓相減只剩日期差，不受時分秒影響 */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function priceStaleness(
  priceAsOf: string | null | undefined,
  now: Date,
): Staleness | null {
  if (!priceAsOf) return null;

  // 補上 T00:00:00 走當地時區解析。直接 new Date('2026-08-03') 會被當成 UTC，
  // 在 UTC+8 會偏移成前一天，算出來的天數整個差一天。
  const asOf = new Date(`${priceAsOf}T00:00:00`);
  if (Number.isNaN(asOf.getTime())) return null;

  const days = Math.round((startOfDay(now) - startOfDay(asOf)) / DAY_MS);

  // 資料日期在未來代表資料有問題，回 null 讓畫面不渲染，
  // 不要印一個負數天數出來讓使用者自己解讀。
  if (days < 0) return null;

  return { days, stale: days >= 1 };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run artifacts/web/src/lib/staleness.test.ts`
Expected: PASS，9 個測試全綠

- [ ] **Step 5: 型別檢查與提交**

```bash
pnpm run typecheck
git add artifacts/web/src/lib/staleness.ts artifacts/web/src/lib/staleness.test.ts
git commit -m "報價新鮮度改算實際天數，連假後的四天不再和昨天長得一樣"
```

---

### Task 2: 延遲警示接進操作建議橫幅

**Files:**
- Modify: `artifacts/web/src/components/stock/advice-banner.tsx:1-113`

**Interfaces:**
- Consumes: Task 1 的 `priceStaleness(priceAsOf, now): Staleness | null`
- Produces: `AdviceBanner` 多一個選用 prop `now?: Date`（預設 `new Date()`），讓測試與呼叫端能注入時鐘

- [ ] **Step 1: 改 import 與 props**

修改 `artifacts/web/src/components/stock/advice-banner.tsx`，在既有 import 之後加入：

```tsx
import { priceStaleness } from '@/lib/staleness';
```

並在 `AdviceBannerProps` 介面末尾（`priceAsOf` 之後）加入：

```tsx
  /** 注入時鐘，預設為現在。抽成 prop 才能測跨連假的顯示 */
  now?: Date;
```

以及把函式簽名的解構加上 `now = new Date()`：

```tsx
export function AdviceBanner({
  advice,
  currentPrice,
  entryLow,
  entryHigh,
  stopLoss,
  priceAsOf,
  now = new Date(),
}: AdviceBannerProps) {
```

- [ ] **Step 2: 換掉底部那行灰字**

把檔案末尾這一段：

```tsx
        {priceAsOf && (
          <div className="text-xs text-muted-foreground">
            以 {priceAsOf} 收盤價判斷，非盤中即時報價
          </div>
        )}
```

整段換成：

```tsx
        {/* 這行先前是 text-xs 的灰字，而它正上方的現價是 text-xl 粗體 ——
            視覺權重與資訊重要性完全相反。使用者最容易犯的錯就是照著昨天的
            收盤價今天掛單，而台股開盤跳空是常態。過期時給警示底色，
            並把「幾天前」直接算出來：連假後那個差距可能是四天。 */}
        {stale && (
          <div
            className={`text-xs rounded px-2 py-1 mt-1 ${
              stale.stale
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium'
                : 'text-muted-foreground'
            }`}
          >
            {stale.stale
              ? `⚠️ 這是 ${stale.days} 個日曆日前（${priceAsOf}）的收盤價，非盤中即時報價 —— 請勿直接照此價位掛單`
              : `以 ${priceAsOf} 收盤價判斷，非盤中即時報價`}
          </div>
        )}
```

並在 `const { Icon, title, body, className } = view;` 這一行之後加入：

```tsx
  const stale = priceStaleness(priceAsOf, now);
```

- [ ] **Step 3: 跑測試與型別檢查**

Run: `pnpm test && pnpm run typecheck`
Expected: 全綠。既有測試不涵蓋這個元件，這一步驗證的是沒有打破別的東西。

- [ ] **Step 4: 目視確認**

Run: `pnpm --filter @workspace/web run dev`，開 <http://localhost:5173>，查任一代號（例：2330），確認卡片上的操作建議橫幅底部出現琥珀色警示列，且天數與 `priceAsOf` 對得上。

- [ ] **Step 5: 提交**

```bash
git add artifacts/web/src/components/stock/advice-banner.tsx
git commit -m "報價延遲改成警示列，不再用最小的字講最容易讓人虧錢的事"
```

---

### Task 3: 毛值風報比降級

**Files:**
- Modify: `artifacts/web/src/components/stock-card.tsx:326-364`

**Interfaces:**
- Consumes: 既有的 `riskRewardRatio`（毛值）與 `netRiskReward`（扣費後）
- Produces: 無新介面

**背景：** commit `4014ffb` 已經把賠率警示的判斷依據換成扣費後的比值，但畫面上毛值仍排在扣費後的**上面一列**，視覺順序暗示它才是主指標。實測十檔有四檔兩者跨越 1.0，那四檔正是最需要清楚的情況，卻同時看到兩個矛盾的結論。

- [ ] **Step 1: 把扣費後那組提到前面**

在 `stock-card.tsx` 中，找到「風報比 / 單張最大虧損」與「扣費後風報比 / 單張淨獲利」兩個 `<div className="flex justify-between text-sm">` 區塊。把**扣費後**那一組整段移到**毛值**那一組之前，並將扣費後的標籤改為主標：

```tsx
                {/* 扣費後才是實際到手的賠率，因此排在前面且用主色。
                    毛值是價差算出來的，下單要付兩趟手續費與一趟證交稅，
                    先印毛值等於系統性地把每一筆交易講得比實際好。 */}
                {netRiskReward != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      風報比（扣費後）:{' '}
                      <strong className={netRiskReward < 1 ? 'text-destructive' : 'text-foreground'}>
                        {netRiskReward.toFixed(2)}
                      </strong>
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1">
                      單張最大虧損:{' '}
                      <strong className="text-destructive font-mono">
                        NT$ {economics.netRiskPerLot.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </strong>
                    </span>
                  </div>
                )}
```

- [ ] **Step 2: 毛值收進可展開區**

把原本毛值那一組（含「單張最大虧損」）換成：

```tsx
                {/* 毛值保留的價值是「對照」，不是主指標 —— 它讓使用者看得出
                    成本吃掉了多少。放在展開區，預設不與扣費後的數字並排競爭。 */}
                {riskRewardRatio != null && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">未扣費用的帳面數字</summary>
                    <div className="mt-1 space-y-0.5 font-mono">
                      <div>帳面風報比：{riskRewardRatio.toFixed(2)}（以價差計算，未計手續費與證交稅）</div>
                      <div>
                        單張淨獲利：NT${' '}
                        {economics.netRewardPerLot.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </details>
                )}
```

- [ ] **Step 3: 確認警示句不受影響**

`netRiskReward < 1` 的警示區塊保持原樣不動 —— 它已經正確引用了毛值與淨值兩個數字來解釋「賠率被交易成本翻面」，那段文字本來就是這次要凸顯的東西。

- [ ] **Step 4: 跑測試與型別檢查**

Run: `pnpm test && pnpm run typecheck`
Expected: 全綠

- [ ] **Step 5: 提交**

```bash
git add artifacts/web/src/components/stock-card.tsx
git commit -m "扣費後風報比提為主指標，毛值收進展開區只當對照"
```

---

### Task 4: OutcomeTally 補上成立率

**Files:**
- Modify: `artifacts/api-server/src/lib/outcome.ts:138-182`
- Modify: `lib/api-spec/openapi.yaml:301-323`
- Test: `artifacts/api-server/src/lib/outcome.test.ts`

**Interfaces:**
- Consumes: 既有的 `OutcomeKind`、`tallyOutcomes(results)`
- Produces: `OutcomeTally` 新增 `entered: number` 與 `entryRate: number | null`

**背景：** `targetRate = target ÷ (target + stop)`。假設 50 筆計畫中 40 筆 `no_entry`、6 筆 `target`、4 筆 `stop`，畫面會顯示「達標率 60%」，而那 40 筆從未成立的計畫完全看不見。分母排除 `no_entry` 在統計上正確，問題在於沒有把成立率一起講 —— 對「這個工具實不實用」而言，成立率比達標率更關鍵。

- [ ] **Step 1: 寫失敗的測試**

在 `artifacts/api-server/src/lib/outcome.test.ts` 既有的 `tallyOutcomes` describe 區塊內（若無則新增）加入：

```ts
  it("成立率的分子是真的進場的筆數，達標率看不出這件事", () => {
    // 40 筆從未觸發進場、6 筆達標、4 筆停損 ——
    // 達標率 60% 講的是「成立的那 10 筆裡有幾筆達標」，
    // 而使用者手上有 50 筆紀錄。少了成立率，那 40 筆會憑空消失。
    const results = [
      ...Array.from({ length: 40 }, () => ({ kind: "no_entry" as const })),
      ...Array.from({ length: 6 }, () => ({ kind: "target" as const })),
      ...Array.from({ length: 4 }, () => ({ kind: "stop" as const })),
    ];
    const tally = tallyOutcomes(results);
    expect(tally.targetRate).toBe(60);
    expect(tally.entered).toBe(10);
    expect(tally.entryRate).toBe(20);
  });

  it("仍持有與同日觸及兩者都算成立 —— 那些交易確實發生了", () => {
    const tally = tallyOutcomes([
      { kind: "open" },
      { kind: "ambiguous" },
      { kind: "no_entry" },
    ]);
    expect(tally.entered).toBe(2);
    expect(tally.entryRate).toBeCloseTo(66.7, 1);
  });

  it("資料不足者不進成立率的分母 —— 與 ambiguous 不進達標率分母同一個原則", () => {
    const tally = tallyOutcomes([
      { kind: "target" },
      { kind: "no_entry" },
      { kind: "unknown" },
    ]);
    // 分母是 1 筆成立 + 1 筆未進場 = 2，unknown 不算
    expect(tally.entryRate).toBe(50);
  });

  it("沒有任何可判定的筆數時成立率為 null，不以 0% 假裝有結論", () => {
    expect(tallyOutcomes([{ kind: "unknown" }]).entryRate).toBeNull();
    expect(tallyOutcomes([]).entryRate).toBeNull();
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run artifacts/api-server/src/lib/outcome.test.ts`
Expected: FAIL，`tally.entered` 與 `tally.entryRate` 為 undefined

- [ ] **Step 3: 改 interface**

在 `artifacts/api-server/src/lib/outcome.ts` 的 `OutcomeTally` 介面中，於 `targetRate` 之後加入：

```ts
  /** 真的進場的筆數（達標＋停損＋同日觸及＋仍持有），成立率的分子 */
  entered: number;
  /**
   * 成立率（%）—— 計畫中有多少比例真的變成交易。
   *
   * 達標率的分母刻意排除了未進場的計畫，那在統計上正確；但少了這個數字，
   * 「大部分計畫從未成立」這件事在畫面上完全看不見，而它決定這個工具的實用價值。
   * 可判定筆數為 0 時為 null，不以 0% 假裝有結論。
   */
  entryRate: number | null;
```

- [ ] **Step 4: 改實作**

在 `tallyOutcomes` 的初始物件中加入兩個欄位：

```ts
    decided: 0,
    targetRate: null,
    entered: 0,
    entryRate: null,
```

並在 `tally.targetRate = ...` 那一段之後加入：

```ts
  // 成立＝價格確實進入過進場區。unknown 是「判不出來」，兩邊都不進 ——
  // 與 ambiguous 不進達標率分母同一個原則：不知道就是不知道。
  tally.entered = tally.target + tally.stop + tally.ambiguous + tally.open;
  const entryDecided = tally.entered + tally.noEntry;
  tally.entryRate =
    entryDecided > 0 ? Math.round((tally.entered / entryDecided) * 1000) / 10 : null;
```

- [ ] **Step 5: 跑測試確認通過**

Run: `pnpm vitest run artifacts/api-server/src/lib/outcome.test.ts`
Expected: PASS

- [ ] **Step 6: 更新契約**

修改 `lib/api-spec/openapi.yaml` 的 `OutcomeTally`，在 `targetRate` 之後加入：

```yaml
        entered:
          type: number
          description: 真的進場的筆數（達標＋停損＋同日觸及＋仍持有），成立率的分子
        entryRate:
          type: number
          nullable: true
          description: >-
            成立率（%）—— 計畫中有多少比例真的變成交易。達標率的分母排除了未進場的
            計畫，少了這個數字「大部分計畫從未成立」在畫面上看不見。
            可判定筆數為 0 時為 null。
```

並把 `required` 那一行改為：

```yaml
      required: [target, stop, ambiguous, open, noEntry, unknown, decided, entered]
```

- [ ] **Step 7: 重新產生前端型別**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: `lib/api-zod` 與 `lib/api-client-react` 產生物更新，`OutcomeTally` 多出兩個欄位

- [ ] **Step 8: 全測試與型別檢查，提交**

```bash
pnpm test && pnpm run typecheck
git add artifacts/api-server/src/lib/outcome.ts artifacts/api-server/src/lib/outcome.test.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "驗證補上成立率，達標率不再讓從未成立的計畫憑空消失"
```

---

### Task 5: 驗證結果顯示五格與成立率

**Files:**
- Modify: `artifacts/web/src/pages/home.tsx:221-253`

**Interfaces:**
- Consumes: Task 4 的 `tally.entered`、`tally.entryRate`；既有的 `OUTCOME_LABEL`
- Produces: 無新介面

**背景：** `tally` 有六個計數欄位，畫面只顯示三個（達標／停損／仍持有）。`noEntry` 與 `ambiguous` 完全沒出現，而 `verify.ts` 的 `OUTCOME_LABEL` 早就定義好這兩個的文字，定義了卻沒用。使用者有 50 筆紀錄但三格加起來只有 10，畫面沒有一個字解釋差額。

- [ ] **Step 1: 把達標率那一列改成兩個指標並列**

在 `home.tsx` 中，把顯示達標率的那個 `<div className="flex justify-between items-center pb-2 border-b border-border">` 整段換成：

```tsx
                <div className="space-y-2 pb-3 border-b border-border">
                  <div className="flex justify-between items-center">
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
                  {/* 成立率必須與達標率並列。達標率的分母只算已分出勝負的筆數，
                      單獨看會讓「大部分計畫從未觸發進場」完全看不見 ——
                      而那決定這個工具實不實用。 */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground text-sm">計畫成立率</span>
                    <span className="text-lg font-bold">
                      {tally.entryRate != null ? `${tally.entryRate.toFixed(1)}%` : '尚無結論'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    達標率的分母只算已分出勝負的 {tally.decided} 筆；成立率算的是價格確實進入過
                    進場區的 {tally.entered} 筆。兩者分母不同，不能相乘。
                  </p>
                </div>
```

- [ ] **Step 2: 三格改五格**

把 `<div className="grid grid-cols-3 gap-2 text-center text-sm">` 整段換成：

```tsx
                {/* 五格而非三格：未進場與同日觸及兩者先前完全沒顯示，
                    OUTCOME_LABEL 早就定義好文字卻沒用上。少了它們，
                    使用者手上 50 筆紀錄而畫面只加得出 10 筆。 */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-sm">
                  <div className="bg-muted rounded p-2">
                    <div className="text-primary font-bold">{tally.target}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['target']}</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-destructive font-bold">{tally.stop}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['stop']}</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-foreground font-bold">{tally.open}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['open']}</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-muted-foreground font-bold">{tally.noEntry}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['no_entry']}</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-muted-foreground font-bold">{tally.ambiguous}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['ambiguous']}</div>
                  </div>
                </div>
```

- [ ] **Step 3: 補 import**

把 `home.tsx` 既有的 `import { buildVerifyGroups, isRipe } from '@/lib/verify';` 改為：

```tsx
import { buildVerifyGroups, isRipe, OUTCOME_LABEL } from '@/lib/verify';
```

- [ ] **Step 4: 跑測試與型別檢查**

Run: `pnpm test && pnpm run typecheck`
Expected: 全綠

- [ ] **Step 5: 提交**

```bash
git add artifacts/web/src/pages/home.tsx
git commit -m "驗證改顯示五格與成立率，未進場的計畫不再從畫面上消失"
```

---

### Task 6: 驗證門檻隨分析週期調整

**Files:**
- Modify: `artifacts/web/src/lib/verify.ts:12-37, 86-121`
- Test: `artifacts/web/src/lib/verify.test.ts`

**Interfaces:**
- Consumes: `HistoryMeta.period: AnalyzeRequestPeriod`（已存在於 `lib/history.ts:32`）
- Produces: `isRipe(createdAt: number, period: string | null | undefined, now?: number): boolean` —— **簽名變更，多了第二個參數**

**背景：** `MIN_CALENDAR_DAYS = 7` ≈ 5 個交易日，但計畫的失效天數是 10／20／30 個交易日（依 1m／3m／6m）。一份 6m 計畫存 5 個交易日就去對答案，幾乎必然回 `open` 或 `no_entry`。使用者第一次用就得到一個沒有結論的畫面，很容易就不再點了。

- [ ] **Step 1: 寫失敗的測試**

在 `artifacts/web/src/lib/verify.test.ts` 加入：

```ts
describe('isRipe 隨週期調整門檻', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date('2026-08-04T09:00:00').getTime();

  it('短線計畫等一週就值得對答案 —— 它的失效期限只有 10 個交易日', () => {
    expect(isRipe(now - 7 * DAY, '1m', now)).toBe(true);
    expect(isRipe(now - 6 * DAY, '1m', now)).toBe(false);
  });

  it('波段計畫要等更久 —— 失效期限 20 個交易日，太早問只會拿到「仍持有」', () => {
    expect(isRipe(now - 13 * DAY, '3m', now)).toBe(false);
    expect(isRipe(now - 14 * DAY, '3m', now)).toBe(true);
  });

  it('中長線計畫等最久 —— 30 個交易日約當六週', () => {
    expect(isRipe(now - 20 * DAY, '6m', now)).toBe(false);
    expect(isRipe(now - 21 * DAY, '6m', now)).toBe(true);
  });

  it('週期缺失或認不得時退回基準週期，與 strategyFor 的處理一致', () => {
    expect(isRipe(now - 14 * DAY, null, now)).toBe(true);
    expect(isRipe(now - 13 * DAY, undefined, now)).toBe(false);
    expect(isRipe(now - 13 * DAY, '99y', now)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run artifacts/web/src/lib/verify.test.ts`
Expected: FAIL —— 現行 `isRipe` 只吃兩個參數，第二個是 `now`，傳入 `'1m'` 會被當成時間戳

- [ ] **Step 3: 改實作**

把 `artifacts/web/src/lib/verify.ts` 的 `MIN_TRADING_DAYS_BEFORE_VERIFY`／`MIN_CALENDAR_DAYS`／`isRipe` 三段（第 12～37 行）換成：

```ts
/**
 * 各週期至少要經過幾個日曆日才值得驗證。
 *
 * 太早去對答案，絕大多數都還是「仍持有」，除了消耗額度沒有意義。
 * 門檻必須隨週期走：計畫的失效期限是 10／20／30 個交易日，
 * 一份 6m 計畫存五個交易日就去問，幾乎必然回「仍持有」或「未進場」——
 * 使用者第一次用就拿到一個沒有結論的畫面，很容易就不再點了。
 *
 * 取各週期失效期限的一半，再換算成日曆日（交易日 × 7/5）：
 *   1m：10 個交易日 → 一半 5 → 7 個日曆日
 *   3m：20 個交易日 → 一半 10 → 14 個日曆日
 *   6m：30 個交易日 → 一半 15 → 21 個日曆日
 * 「一半」是經驗值，只影響何時開始檢查，不影響任何判定結果 ——
 * 因此不像機率表那樣需要驗證。
 */
const MIN_CALENDAR_DAYS: Record<string, number> = { '1m': 7, '3m': 14, '6m': 21 };

/** 週期缺失或認不得時採用的基準，與後端 normalizePeriod 一致 */
const DEFAULT_PERIOD = '3m';

const DAY_MS = 24 * 60 * 60 * 1000;

/** epoch → YYYY-MM-DD（本地時區，與使用者看到的日期一致） */
export function toDateKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 這筆紀錄是否已經舊到值得驗證 */
export function isRipe(
  createdAt: number,
  period: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const days = MIN_CALENDAR_DAYS[period ?? ''] ?? MIN_CALENDAR_DAYS[DEFAULT_PERIOD]!;
  return now - createdAt >= days * DAY_MS;
}
```

注意：原本的 `export const MIN_TRADING_DAYS_BEFORE_VERIFY = 5;` 一併刪除。若有其他檔案引用它，`pnpm run typecheck` 會抓出來。

- [ ] **Step 4: 更新兩個呼叫端**

在同一檔案中，把 `buildVerifyItems` 與 `buildVerifyGroups` 裡的 filter 各自改為：

```ts
  const ripe = index.filter((entry) => isRipe(entry.createdAt, entry.period, now));
```

- [ ] **Step 5: 更新 home.tsx 的呼叫端**

把 `home.tsx:74` 的 `hasRipeHistory` 改為：

```tsx
  const hasRipeHistory = useMemo(
    () => history.some((entry) => isRipe(entry.createdAt, entry.period)),
    [history],
  );
```

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm test`
Expected: PASS。既有 `verify.test.ts` 中呼叫舊簽名的測試會失敗 —— 把它們一併改為新簽名，並保留原本的斷言意圖。

- [ ] **Step 7: 型別檢查與提交**

```bash
pnpm run typecheck
git add artifacts/web/src/lib/verify.ts artifacts/web/src/lib/verify.test.ts artifacts/web/src/pages/home.tsx
git commit -m "驗證門檻改隨週期走，六個月的計畫不再存五天就被問結果"
```

---

### Task 7: 驗證結果持久化

**Files:**
- Create: `artifacts/web/src/lib/verifyStore.ts`
- Test: `artifacts/web/src/lib/verifyStore.test.ts`
- Modify: `artifacts/web/src/pages/home.tsx:35-64`

**Interfaces:**
- Consumes: `VerifyOutcomesResult['tally']`（Orval 產生）
- Produces:
  - `interface StoredVerify { ruleVersion: number; tally: OutcomeTally; verifiedAt: number }`
  - `saveVerify(summaries: StoredVerify[]): void`
  - `loadVerify(): StoredVerify[]`
  - `latestFor(summaries: StoredVerify[], ruleVersion: number): StoredVerify | null`

**背景：** 驗證結果存在 `useState`（`home.tsx:36`），離開頁面就消失。下次進來又要重按一次「對答案」。而 Task 8 要把達標率帶到分析頁的卡片旁，那需要跨頁讀得到。

- [ ] **Step 1: 寫失敗的測試**

建立 `artifacts/web/src/lib/verifyStore.test.ts`：

```ts
import { beforeEach, describe, expect, it } from 'vitest';

// 必須排在第一個 import：vitest 跑 node 環境沒有 localStorage，
// 這個模組在被 import 的當下就把記憶體替身掛上 globalThis。
// 比照 history.test.ts 的做法，不改用 jsdom。
import stub from '../../../../test/localStorageStub';
import { latestFor, loadVerify, saveVerify, type StoredVerify } from './verifyStore';

const tally = {
  target: 6,
  stop: 4,
  ambiguous: 0,
  open: 0,
  noEntry: 40,
  unknown: 0,
  decided: 10,
  targetRate: 60,
  entered: 10,
  entryRate: 20,
};

const sample: StoredVerify[] = [{ ruleVersion: 3, tally, verifiedAt: 1_770_000_000_000 }];

describe('verifyStore', () => {
  beforeEach(() => stub.__reset());

  it('存進去再讀回來是同一份 —— 離開頁面不該讓使用者重按一次對答案', () => {
    saveVerify(sample);
    expect(loadVerify()).toEqual(sample);
  });

  it('沒存過時回空陣列，不是 null —— 呼叫端不必再判一次', () => {
    expect(loadVerify()).toEqual([]);
  });

  it('內容壞掉時當作沒存過，不讓一個壞字串把整張頁面帶下去', () => {
    stub.__seed('verify_results_v1', '{ 不是合法 JSON');
    expect(loadVerify()).toEqual([]);
  });

  it('存的不是陣列時也當作沒存過', () => {
    stub.__seed('verify_results_v1', '{"ruleVersion":3}');
    expect(loadVerify()).toEqual([]);
  });

  it('陣列裡混入形狀不對的項目時只濾掉那一筆，不整份丟棄', () => {
    stub.__seed('verify_results_v1', JSON.stringify([...sample, { 壞掉: true }]));
    expect(loadVerify()).toEqual(sample);
  });

  it('latestFor 取得指定規則版本的結果，混用不同版本的數字量不到任何一套規則', () => {
    const two: StoredVerify[] = [
      { ruleVersion: 2, tally, verifiedAt: 1 },
      { ruleVersion: 3, tally: { ...tally, targetRate: 71 }, verifiedAt: 2 },
    ];
    expect(latestFor(two, 3)?.tally.targetRate).toBe(71);
    expect(latestFor(two, 2)?.tally.targetRate).toBe(60);
  });

  it('查無該版本時回 null —— 卡片就不顯示，不要拿別版的命中率頂替', () => {
    expect(latestFor(sample, 99)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm vitest run artifacts/web/src/lib/verifyStore.test.ts`
Expected: FAIL，找不到模組 `./verifyStore`

- [ ] **Step 3: 寫實作**

建立 `artifacts/web/src/lib/verifyStore.ts`：

```ts
/**
 * 前瞻驗證結果的存放層。
 *
 * 先前結果只存在 `useState` 裡，離開頁面就消失 —— 使用者每次都要重按
 * 一次「對答案」，而這個功能的價值來自累積。存下來之後還有第二個用途：
 * 分析頁的卡片可以把該規則版本的實際達標率印在 E(V) 旁邊。
 * 宣稱與檢驗必須放在一起，那才是這個功能真正的位置。
 *
 * 讀取一律不丟例外 —— 整個 app 沒有 ErrorBoundary，一個壞掉的字串
 * 會把整張頁面帶下去。壞掉就當作沒存過。
 */

import type { VerifyOutcomesResult } from '@workspace/api-client-react';

const KEY = 'verify_results_v1';

export interface StoredVerify {
  ruleVersion: number;
  tally: VerifyOutcomesResult['tally'];
  /** 這份結果是什麼時候跑出來的，畫面要標明它不是即時的 */
  verifiedAt: number;
}

function isStored(value: unknown): value is StoredVerify {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredVerify>;
  return typeof v.ruleVersion === 'number' && typeof v.verifiedAt === 'number' && Boolean(v.tally);
}

export function saveVerify(summaries: StoredVerify[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(summaries));
  } catch {
    // 配額滿或隱私模式 —— 存不下就算了，驗證結果不是非有不可的資料
  }
}

export function loadVerify(): StoredVerify[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStored);
  } catch {
    return [];
  }
}

/**
 * 取指定規則版本的結果。
 *
 * 刻意不做「找不到就回最新版」的退讓：不同規則算出來的進場區與停損停利
 * 不同，拿別版的命中率頂替，數字看起來仍然正常卻已經量不到任何一套規則。
 */
export function latestFor(summaries: StoredVerify[], ruleVersion: number): StoredVerify | null {
  return summaries.find((s) => s.ruleVersion === ruleVersion) ?? null;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm vitest run artifacts/web/src/lib/verifyStore.test.ts`
Expected: PASS

若出現 `localStorage is not defined`，代表 `test/localStorageStub` 的 import 沒有排在第一位 —— 它是靠 import 的副作用把替身掛上 `globalThis`，排在被測模組之後就來不及了。

- [ ] **Step 5: 接進 home.tsx**

把 `home.tsx` 的 state 宣告改為從 store 初始化：

```tsx
import { latestFor, loadVerify, saveVerify, type StoredVerify } from '@/lib/verifyStore';

// ...

  const [verifyResults, setVerifyResults] = useState<StoredVerify[] | null>(() => {
    const stored = loadVerify();
    return stored.length > 0 ? stored : null;
  });
```

並刪除原本的 `type VerifySummary = ...` 宣告（改用 `StoredVerify`）。

把 `handleVerify` 中的 `setVerifyResults(summaries);` 之前，改為帶上時間戳並存檔：

```tsx
      const summaries: StoredVerify[] = await Promise.all(
        groups.map(async (g) => ({
          ruleVersion: g.ruleVersion,
          tally: (await verifyOutcomes.mutateAsync({ data: { items: g.items } })).tally,
          verifiedAt: Date.now(),
        })),
      );
      saveVerify(summaries);
      setVerifyResults(summaries);
```

- [ ] **Step 6: 在結果區塊標示驗證時間**

在 `verifyResults?.map(...)` 產生的每個區塊底部（五格 grid 之後）加入：

```tsx
                <p className="text-[11px] text-muted-foreground">
                  驗證於 {new Date(verifiedAt).toLocaleString('zh-TW')} —— 這是當時的結果，不是即時值
                </p>
```

並把 map 的解構改為 `{({ ruleVersion, tally, verifiedAt }) => (`。

- [ ] **Step 7: 跑測試與型別檢查，提交**

```bash
pnpm test && pnpm run typecheck
git add artifacts/web/src/lib/verifyStore.ts artifacts/web/src/lib/verifyStore.test.ts artifacts/web/src/pages/home.tsx
git commit -m "驗證結果存進 localStorage，離開頁面不再要求重按一次對答案"
```

---

### Task 8: 自動驗證與達標率入卡片

**Files:**
- Modify: `artifacts/web/src/pages/home.tsx`
- Modify: `artifacts/web/src/pages/analysis.tsx`
- Modify: `artifacts/web/src/components/stock-card.tsx`

**Interfaces:**
- Consumes: Task 7 的 `loadVerify()`、`latestFor()`；`StockDetailResult.ruleVersion`
- Produces: `StockCard` 多一個選用 prop `verified?: StoredVerify | null`

**背景：** 這個功能的價值來自累積，靠使用者手動點擊等於沒有。而它真正該出現的位置是 E(V) 旁邊 —— 那個 `text-3xl font-black` 的數字是由一張未經回測的機率表算出來的，實際達標率是唯一能校正這個印象的東西。

- [ ] **Step 1: 首頁自動驗證**

在 `home.tsx` 的 `hasRipeHistory` 之後加入：

```tsx
  /**
   * 有可驗證的紀錄而且還沒有結果時，自動跑一次。
   *
   * 這個功能的價值來自累積 —— 靠使用者記得手動點擊等於沒有。
   * 只在「沒有任何存下來的結果」時自動觸發，不做定時重跑：
   * 後端一次最多收 40 筆，而重跑的邊際價值遠低於它消耗的請求。
   * 想要更新的人按「重新對答案」即可。
   */
  useEffect(() => {
    if (!hasRipeHistory) return;
    if (verifyResults !== null) return;
    if (verifyOutcomes.isPending) return;
    void handleVerify();
    // handleVerify 每次 render 都是新的參考，列進相依會造成無限迴圈；
    // 這裡要的就是「條件成立時跑一次」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRipeHistory, verifyResults]);
```

並在 `home.tsx` 的 React import 補上 `useEffect`。

- [ ] **Step 2: 按鈕文案隨狀態改變**

把「對答案」按鈕的文字改為：

```tsx
              {verifyOutcomes.isPending
                ? '驗證中...'
                : verifyResults
                  ? '重新對答案'
                  : '對答案'}
```

- [ ] **Step 3: 卡片接受驗證結果**

在 `stock-card.tsx` 的 `StockCardProps` 加入：

```tsx
  /** 這張卡片所屬規則版本的實際驗證結果。null 代表尚未累積到可驗證的紀錄 */
  verified?: StoredVerify | null;
```

並在檔案頂端加入 import：

```tsx
import type { StoredVerify } from '@/lib/verifyStore';
```

函式簽名改為 `export function StockCard({ stock, detail, loading, settings, verified }: StockCardProps) {`

- [ ] **Step 4: 在 E(V) 旁顯示實際達標率**

把 `stock-card.tsx` 中「加權期望值 E(V)」那個 `<div className="flex items-center justify-between">` 之後、`<div className="space-y-2">`（三情境 bar）之前，插入：

```tsx
          {/* 實際達標率印在 E(V) 正下方。E(V) 由一張未經回測的機率表算出，
              而前瞻驗證是唯一能校正那個印象的東西 —— 它先前只出現在首頁，
              等於把宣稱與檢驗放在兩個不同的畫面上。 */}
          {verified?.tally.targetRate != null && (
            <div className="text-xs bg-muted/40 border border-border rounded px-2 py-1.5 leading-relaxed">
              <span className="text-muted-foreground">這套規則（v{verified.ruleVersion}）目前實測：</span>
              <span className="font-bold text-foreground"> 達標率 {verified.tally.targetRate.toFixed(1)}%</span>
              <span className="text-muted-foreground">（已結案 {verified.tally.decided} 筆）</span>
              {verified.tally.entryRate != null && (
                <span className="text-muted-foreground">
                  ，計畫成立率 {verified.tally.entryRate.toFixed(1)}%
                </span>
              )}
            </div>
          )}
```

- [ ] **Step 5: analysis.tsx 傳入**

在 `analysis.tsx` 頂端加入：

```tsx
import { latestFor, loadVerify } from '@/lib/verifyStore';
```

在元件內、`derivedStockDetails` 附近加入：

```tsx
  // 驗證結果只在掛載時讀一次 —— 它是使用者在首頁跑出來的，
  // 本頁不會改變它，沒有理由每次 render 都重新解析 localStorage。
  const verifySummaries = useMemo(() => loadVerify(), []);
```

並把渲染 `<StockCard ... />` 的地方補上 prop：

```tsx
                verified={
                  derivedStockDetails[stock.code]?.ruleVersion != null
                    ? latestFor(verifySummaries, derivedStockDetails[stock.code]!.ruleVersion!)
                    : null
                }
```

- [ ] **Step 6: 跑測試與型別檢查**

Run: `pnpm test && pnpm run typecheck`
Expected: 全綠

- [ ] **Step 7: 手動驗證整條路徑**

Run: `pnpm run build && PORT=5000 pnpm start`，開 <http://localhost:5000>：

1. 首頁在有夠舊的紀錄時應**自動**顯示驗證結果，不必按按鈕
2. 結果應有五格、成立率、驗證時間
3. 重新整理頁面，結果仍在（不再消失）
4. 進到分析頁，卡片的 E(V) 下方應出現「這套規則（vN）目前實測：達標率 …」
5. 若尚無該規則版本的驗證結果，該行整塊不顯示（不顯示 0% 或空殼）

- [ ] **Step 8: 提交**

```bash
git add artifacts/web/src/pages/home.tsx artifacts/web/src/pages/analysis.tsx artifacts/web/src/components/stock-card.tsx
git commit -m "驗證改為自動觸發並印在 E(V) 旁，宣稱與檢驗終於在同一個畫面上"
```

---

## 完成標準

全部八個 Task 完成後，以下皆須成立：

- [ ] `pnpm test` 全綠
- [ ] `pnpm run typecheck` 全綠
- [ ] `pnpm run build` 成功
- [ ] 報價過期時卡片上有琥珀色警示列，並印出實際天數
- [ ] 扣費後風報比排在毛值之前，毛值收在展開區
- [ ] 驗證結果顯示五格（含未進場、同日觸及）與成立率
- [ ] 驗證結果重新整理後仍在
- [ ] 卡片的 E(V) 下方顯示該規則版本的實際達標率
- [ ] `RULE_VERSION` 未變動

## 後續計畫

本計畫只涵蓋「讓既有數字不誤導」。另外兩份計畫將分別處理：

- **Plan 2 — 大盤與族群基準**：`TaiwanStockPrice&data_id=TAIEX`（+1 請求／次分析）、同供應鏈相對強弱（0 額外請求）。兩者只陳述、不進評分，不動 `ruleVersion`。
- **Plan 3 — 受眾分流與財報資料**：`lib/view-profile` 五視圖、六個 FinMind 財報／股利資料集（財報三表延後載入）。
