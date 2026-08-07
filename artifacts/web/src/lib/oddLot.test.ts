import { describe, expect, it } from 'vitest';

import { netPnl, roundTripCostPctFor } from './fees';
import { planOddLot } from './oddLot';

/**
 * 貫穿本檔的例子：NT$1,000 的股票、停損 915.4（＝2 × ATR 30 × 3 個月係數 1.41）。
 * 一張要 100 萬，超過單檔上限 30 萬，所以整張路徑一定算出 0 張 —— 正是零股要接手的情況。
 */
const CASE = { entryPrice: 1000, stopLoss: 915.4 };
const SETTINGS = { riskBudget: 20_000, capital: 1_000_000, maxPositionPct: 0.3 };

const lossAt = (shares: number, discount = 1) =>
  Math.abs(netPnl(CASE.entryPrice, CASE.stopLoss, shares, discount));

describe('planOddLot 求最大股數', () => {
  it('取到的是真正的最大值 —— 再多一股就超過風險上限', () => {
    // 只驗「沒超過」的話，回傳 1 股也會通過。必須同時驗「再多一股就爆」。
    const plan = planOddLot({ ...SETTINGS, ...CASE })!;
    expect(lossAt(plan.shares)).toBeLessThanOrEqual(SETTINGS.riskBudget);
    expect(lossAt(plan.shares + 1)).toBeGreaterThan(SETTINGS.riskBudget);
  });

  it('手算的例子對得上', () => {
    const plan = planOddLot({ ...SETTINGS, ...CASE })!;
    expect(plan.shares).toBe(222);
    expect(plan.cost).toBe(222_000);
    expect(plan.risk).toBeCloseTo(19_996.79, 1);
    expect(plan.costPct).toBeCloseTo(0.585, 3);
    expect(plan.limitedBy).toBe('risk');
    expect(plan.capitalCap).toBe(300_000);
    expect(plan.pctOfCapital).toBeCloseTo(22.2, 6);
  });

  it('資金上限先綁住時歸咎於資金', () => {
    // 風險上限放到極大，只剩單檔上限 30% × 100 萬 = 30 萬擋著
    const plan = planOddLot({ ...SETTINGS, ...CASE, riskBudget: 10_000_000 })!;
    expect(plan.shares).toBe(300);
    expect(plan.cost).toBe(300_000);
    expect(plan.limitedBy).toBe('capital');
  });

  it('券商折扣讓同樣的風險上限買得到更多股', () => {
    const full = planOddLot({ ...SETTINGS, ...CASE, feeDiscount: 1 })!;
    const cheap = planOddLot({ ...SETTINGS, ...CASE, feeDiscount: 0.28 })!;
    expect(cheap.shares).toBeGreaterThan(full.shares);
    expect(lossAt(cheap.shares, 0.28)).toBeLessThanOrEqual(SETTINGS.riskBudget);
  });

  it('小部位的成本佔比由低消主導', () => {
    // 資金 2 萬 × 30% = 6,000，風險上限 400 元，只買得起個位數股
    const plan = planOddLot({ ...CASE, riskBudget: 400, capital: 20_000, maxPositionPct: 0.3 })!;
    expect(plan.shares).toBe(4);
    expect(plan.costPct).toBeCloseTo(roundTripCostPctFor(CASE.entryPrice, 4), 6);
    expect(plan.costPct).toBeGreaterThan(1);
  });
});

describe('掃描各種價格與停損距離，不變式都成立', () => {
  // 單一手算案例驗不出二分搜尋的邊界錯誤 —— off-by-one 只在特定的
  // 「剛好卡在低消翻轉點」或「上限剛好整除」的組合上才會現形。
  const prices = [11.5, 50, 137, 499, 1000, 1385, 3020];
  const stopPcts = [0.02, 0.05, 0.085, 0.14, 0.3];
  const budgets = [400, 5_000, 20_000, 120_000];

  it('回傳的股數永遠是滿足兩個上限的最大值', () => {
    let checked = 0;
    for (const entryPrice of prices) {
      for (const stopPct of stopPcts) {
        const stopLoss = entryPrice * (1 - stopPct);
        for (const riskBudget of budgets) {
          const plan = planOddLot({ entryPrice, stopLoss, riskBudget, capital: 1_000_000 });
          if (plan === null) continue;
          checked += 1;

          const loss = (n: number) => Math.abs(netPnl(entryPrice, stopLoss, n, 1));
          expect(plan.shares).toBeGreaterThanOrEqual(1);
          expect(loss(plan.shares)).toBeLessThanOrEqual(riskBudget);
          expect(plan.shares * entryPrice).toBeLessThanOrEqual(plan.capitalCap);

          // 再多一股就必須違反其中一個上限，否則就不是最大值
          const next = plan.shares + 1;
          const stillFits = loss(next) <= riskBudget && next * entryPrice <= plan.capitalCap;
          expect(stillFits).toBe(false);
        }
      }
    }
    // 掃描本身要有掃到東西，否則這條測試等於什麼都沒驗
    expect(checked).toBeGreaterThan(100);
  });
});

describe('planOddLot 回 null 的情況', () => {
  it('停損不低於進場價', () => {
    // netPnl 在這種輸入下是獲利，取絕對值後仍然單調，
    // 會算出一個看起來完全正常的假股數 —— 必須擋在最前面。
    expect(planOddLot({ ...SETTINGS, entryPrice: 1000, stopLoss: 1000 })).toBeNull();
    expect(planOddLot({ ...SETTINGS, entryPrice: 1000, stopLoss: 1100 })).toBeNull();
  });

  it('連 1 股都超過風險上限', () => {
    // 1 股最壞賠 127.35，上限只有 100
    expect(planOddLot({ ...SETTINGS, ...CASE, riskBudget: 100 })).toBeNull();
  });

  it('1 股就超過單檔可投入上限', () => {
    // 資金 10 萬 × 30% = 3 萬，但 1 股要 5 萬
    expect(
      planOddLot({ ...SETTINGS, capital: 100_000, entryPrice: 50_000, stopLoss: 45_000 }),
    ).toBeNull();
  });

  it('缺價格或設定非正值', () => {
    expect(planOddLot({ ...SETTINGS, entryPrice: null, stopLoss: 915.4 })).toBeNull();
    expect(planOddLot({ ...SETTINGS, entryPrice: 1000, stopLoss: null })).toBeNull();
    expect(planOddLot({ ...SETTINGS, ...CASE, riskBudget: 0 })).toBeNull();
    expect(planOddLot({ ...SETTINGS, ...CASE, capital: 0 })).toBeNull();
  });

  it('單檔上限超出允許範圍時退回預設 30%，與整張路徑同一套規則', () => {
    const fallback = planOddLot({ ...SETTINGS, ...CASE, maxPositionPct: 0.3 })!;
    for (const bad of [0, 5, Number.NaN]) {
      expect(planOddLot({ ...SETTINGS, ...CASE, maxPositionPct: bad })!.capitalCap).toBe(
        fallback.capitalCap,
      );
    }
  });
});
