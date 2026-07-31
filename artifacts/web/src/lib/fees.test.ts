import { describe, expect, it } from 'vitest';

import {
  BROKERAGE_RATE,
  MIN_BROKERAGE,
  SHARES_PER_LOT,
  TAX_RATE,
  breakevenPrice,
  buyOutlayPerLot,
  discountToTenths,
  lotEconomics,
  netPnlPerLot,
  roundTripCostPct,
  sellProceedsPerLot,
} from './fees';

describe('買進支出', () => {
  it('等於股款加手續費', () => {
    const price = 100;
    const value = price * SHARES_PER_LOT; // 100,000
    expect(buyOutlayPerLot(price)).toBeCloseTo(value + value * BROKERAGE_RATE, 6);
  });

  it('金額極小時套用最低手續費 20 元', () => {
    // 1 元 × 1000 股 = 1000 元，費率算出僅 1.4 元
    expect(buyOutlayPerLot(1)).toBeCloseTo(1000 + MIN_BROKERAGE, 6);
  });
});

describe('賣出入帳', () => {
  it('扣掉手續費與證交稅', () => {
    const price = 100;
    const value = price * SHARES_PER_LOT;
    expect(sellProceedsPerLot(price)).toBeCloseTo(
      value - value * BROKERAGE_RATE - value * TAX_RATE,
      6,
    );
  });

  it('賣出成本高於買進成本（多了證交稅）', () => {
    const price = 500;
    const value = price * SHARES_PER_LOT;
    const buyFee = buyOutlayPerLot(price) - value;
    const sellFee = value - sellProceedsPerLot(price);
    expect(sellFee).toBeGreaterThan(buyFee);
  });
});

describe('淨損益', () => {
  it('原價賣出會小賠，因為來回都要成本', () => {
    expect(netPnlPerLot(100, 100)).toBeLessThan(0);
  });

  it('漲幅小於來回成本時仍是虧損', () => {
    // 來回約 0.585%，漲 0.3% 不夠回本
    expect(netPnlPerLot(100, 100.3)).toBeLessThan(0);
  });

  it('漲幅明顯大於成本時為獲利', () => {
    expect(netPnlPerLot(100, 110)).toBeGreaterThan(0);
  });

  it('淨獲利一定低於帳面價差', () => {
    const gross = (110 - 100) * SHARES_PER_LOT;
    expect(netPnlPerLot(100, 110)).toBeLessThan(gross);
  });

  it('淨虧損一定大於帳面價差', () => {
    const grossLoss = (100 - 90) * SHARES_PER_LOT;
    expect(Math.abs(netPnlPerLot(100, 90))).toBeGreaterThan(grossLoss);
  });
});

describe('損益兩平價', () => {
  it('高於進場價', () => {
    expect(breakevenPrice(100)).toBeGreaterThan(100);
  });

  it('在該價位賣出淨損益約為零', () => {
    const entry = 250;
    expect(netPnlPerLot(entry, breakevenPrice(entry))).toBeCloseTo(0, 6);
  });

  it('所需漲幅約等於來回成本（0.585%）', () => {
    const entry = 100;
    const pct = ((breakevenPrice(entry) - entry) / entry) * 100;
    expect(pct).toBeGreaterThan(0.5);
    expect(pct).toBeLessThan(0.7);
    expect(pct).toBeCloseTo(roundTripCostPct(), 1);
  });

  it('與進場價成正比', () => {
    expect(breakevenPrice(200) / breakevenPrice(100)).toBeCloseTo(2, 6);
  });
});

describe('roundTripCostPct', () => {
  it('為手續費兩次加證交稅一次', () => {
    expect(roundTripCostPct()).toBeCloseTo((0.001425 * 2 + 0.003) * 100, 10);
    expect(roundTripCostPct()).toBeCloseTo(0.585, 3);
  });
});

describe('lotEconomics', () => {
  const base = { entry: 100, stop: 90, target: 120, firstTarget: 110 };

  it('回報四項淨額', () => {
    const e = lotEconomics(base)!;
    expect(e.netRewardPerLot).toBeGreaterThan(0);
    expect(e.netRiskPerLot).toBeGreaterThan(0);
    expect(e.netFirstTargetPerLot).toBeGreaterThan(0);
    expect(e.breakeven).toBeGreaterThan(base.entry);
  });

  it('淨虧損以正數表示', () => {
    expect(lotEconomics(base)!.netRiskPerLot).toBeGreaterThan(0);
  });

  it('扣費後風報比會比帳面差', () => {
    const e = lotEconomics(base)!;
    const grossRR = (base.target - base.entry) / (base.entry - base.stop); // 2.0
    const netRR = e.netRewardPerLot / e.netRiskPerLot;
    expect(netRR).toBeLessThan(grossRR);
  });

  it('沒有第一目標時該欄為 null', () => {
    expect(lotEconomics({ ...base, firstTarget: null })!.netFirstTargetPerLot).toBeNull();
  });

  it('輸入非正值時回傳 null', () => {
    expect(lotEconomics({ entry: 0, stop: 90, target: 120 })).toBeNull();
    expect(lotEconomics({ entry: 100, stop: 0, target: 120 })).toBeNull();
    expect(lotEconomics({ entry: 100, stop: 90, target: 0 })).toBeNull();
  });

  it('有折扣時淨獲利較高、淨虧損較低、兩平價較低', () => {
    const full = lotEconomics(base)!;
    const discounted = lotEconomics({ ...base, discount: 0.28 })!;
    expect(discounted.netRewardPerLot).toBeGreaterThan(full.netRewardPerLot);
    expect(discounted.netRiskPerLot).toBeLessThan(full.netRiskPerLot);
    expect(discounted.breakeven).toBeLessThan(full.breakeven);
  });
});

describe('券商手續費折扣', () => {
  it('只折手續費，不折證交稅', () => {
    // 6 折：手續費率 ×0.6，稅率不動
    expect(roundTripCostPct(0.6)).toBeCloseTo((BROKERAGE_RATE * 0.6 * 2 + TAX_RATE) * 100, 10);
  });

  it('2.8 折的來回成本約 0.38%（未折扣為 0.585%）', () => {
    expect(roundTripCostPct(0.28)).toBeCloseTo(0.3798, 3);
  });

  it('折扣後仍受最低手續費限制', () => {
    // 1 元 × 1000 股，即使 1 折也不會低於 20 元低消
    expect(buyOutlayPerLot(1, 0.1)).toBeCloseTo(1000 + MIN_BROKERAGE, 6);
  });

  it('未提供折扣時等同無折扣', () => {
    expect(roundTripCostPct()).toBe(roundTripCostPct(1));
    expect(netPnlPerLot(100, 110)).toBeCloseTo(netPnlPerLot(100, 110, 1), 6);
  });

  it('無效折扣退回無折扣，寧可高估成本', () => {
    for (const bad of [0, -0.5, 1.5, Number.NaN, null, undefined]) {
      expect(roundTripCostPct(bad)).toBe(roundTripCostPct(1));
    }
  });

  it('折扣後兩平價仍與淨損益一致', () => {
    const entry = 250;
    const discount = 0.35;
    expect(netPnlPerLot(entry, breakevenPrice(entry, discount), discount)).toBeCloseTo(0, 6);
  });

  it('折扣後的兩平漲幅等於折扣後的來回成本率', () => {
    const entry = 500;
    const discount = 0.6;
    const pct = ((breakevenPrice(entry, discount) - entry) / entry) * 100;
    expect(pct).toBeCloseTo(roundTripCostPct(discount), 1);
  });
});

describe('discountToTenths', () => {
  it('倍率換算成台股習慣的折數', () => {
    expect(discountToTenths(1)).toBe('10');
    expect(discountToTenths(0.6)).toBe('6');
    expect(discountToTenths(0.28)).toBe('2.8');
    expect(discountToTenths(0.17)).toBe('1.7');
  });

  it('無效值顯示為無折扣', () => {
    expect(discountToTenths(Number.NaN)).toBe('10');
    expect(discountToTenths(0)).toBe('10');
  });
});
