import { describe, expect, it } from 'vitest';

import { DEFAULT_RISK_SETTINGS, planPosition } from './settings';
import { lotEconomics } from './fees';
import { planPositionFor } from './position';

/**
 * 這一組數字就是缺陷本身。
 *
 * 後端的 riskPerLot 是 (entryMid − stopLoss) × 1000 —— 純價差、以進場區「中值」為基準；
 * 而畫面上印的「最壞會賠」是 lotEconomics 以進場區「上緣」算的、且扣掉兩趟手續費
 * 與一趟證交稅。兩個數字有兩處落差（費用、進場價基準），部位大小卻用前者決定。
 */
const CASE = {
  entryLow: 100,
  entryHigh: 101,
  stopLoss: 95,
  takeProfit: 115,
  firstTarget: 104,
  /** 後端毛值：(100.5 − 95) × 1000 */
  grossRiskPerLot: 5500,
};

const settings = { ...DEFAULT_RISK_SETTINGS, riskBudget: 22000, capital: 10_000_000 };

describe('planPositionFor 以淨風險決定部位', () => {
  it('實際最壞虧損不超過使用者設定的單筆風險上限', () => {
    const view = planPositionFor({
      entryHigh: CASE.entryHigh,
      stopLoss: CASE.stopLoss,
      takeProfit: CASE.takeProfit,
      firstTarget: CASE.firstTarget,
      riskPerLot: CASE.grossRiskPerLot,
      settings,
    });

    const worstCase = view.position!.lots * view.economics!.netRiskPerLot;
    expect(worstCase).toBeLessThanOrEqual(settings.riskBudget);
  });

  it('用毛值算會超出上限 —— 這是修正前的行為，鎖起來避免回歸', () => {
    // 毛值路徑：22000 / 5500 = 剛好 4 張
    const byGross = planPosition({
      riskBudget: settings.riskBudget,
      capital: settings.capital,
      riskPerLot: CASE.grossRiskPerLot,
      entryPrice: CASE.entryHigh,
      maxPositionPct: settings.maxPositionPct,
    })!;
    const net = lotEconomics({
      entry: CASE.entryHigh,
      stop: CASE.stopLoss,
      target: CASE.takeProfit,
      discount: settings.feeDiscount,
    })!;

    expect(byGross.lots).toBe(4);
    // 4 張 × 每張淨虧損 ≈ 26,257，比使用者設的 22,000 超出約 19%
    expect(byGross.lots * net.netRiskPerLot).toBeGreaterThan(settings.riskBudget);
  });

  it('因此張數必定不多於毛值算出來的張數', () => {
    const byGross = planPosition({
      riskBudget: settings.riskBudget,
      capital: settings.capital,
      riskPerLot: CASE.grossRiskPerLot,
      entryPrice: CASE.entryHigh,
      maxPositionPct: settings.maxPositionPct,
    })!;
    const view = planPositionFor({
      entryHigh: CASE.entryHigh,
      stopLoss: CASE.stopLoss,
      takeProfit: CASE.takeProfit,
      riskPerLot: CASE.grossRiskPerLot,
      settings,
    });

    expect(view.position!.lots).toBeLessThan(byGross.lots);
    expect(view.position!.lots).toBe(3);
  });

  it('進場價基準與 economics 一致，都用進場區上緣', () => {
    const view = planPositionFor({
      entryHigh: CASE.entryHigh,
      stopLoss: CASE.stopLoss,
      takeProfit: CASE.takeProfit,
      riskPerLot: CASE.grossRiskPerLot,
      settings,
    });
    expect(view.position!.costPerLot).toBe(CASE.entryHigh * 1000);
  });

  it('缺停利而算不出淨值時退回後端毛值，不是整個不給部位', () => {
    const view = planPositionFor({
      entryHigh: CASE.entryHigh,
      stopLoss: CASE.stopLoss,
      takeProfit: null,
      riskPerLot: CASE.grossRiskPerLot,
      settings,
    });
    expect(view.economics).toBeNull();
    expect(view.position!.lots).toBe(4); // 毛值路徑
  });

  it('缺必要價位時 position 與 economics 都是 null', () => {
    const view = planPositionFor({
      entryHigh: null,
      stopLoss: CASE.stopLoss,
      takeProfit: CASE.takeProfit,
      riskPerLot: CASE.grossRiskPerLot,
      settings,
    });
    expect(view.position).toBeNull();
    expect(view.economics).toBeNull();
    expect(view.netRiskReward).toBeNull();
  });

  it('券商折扣愈好，淨風險愈低，買得到的張數不減少', () => {
    const common = {
      entryHigh: CASE.entryHigh,
      stopLoss: CASE.stopLoss,
      takeProfit: CASE.takeProfit,
      riskPerLot: CASE.grossRiskPerLot,
    };
    const full = planPositionFor({ ...common, settings: { ...settings, feeDiscount: 1 } });
    const cheap = planPositionFor({ ...common, settings: { ...settings, feeDiscount: 0.28 } });

    expect(cheap.economics!.netRiskPerLot).toBeLessThan(full.economics!.netRiskPerLot);
    expect(cheap.position!.lots).toBeGreaterThanOrEqual(full.position!.lots);
  });
});

describe('planPositionFor 的扣費後賠率', () => {
  it('比帳面風報比差', () => {
    const view = planPositionFor({
      entryHigh: CASE.entryHigh,
      stopLoss: CASE.stopLoss,
      takeProfit: CASE.takeProfit,
      riskPerLot: CASE.grossRiskPerLot,
      settings,
    });
    const gross = (CASE.takeProfit - CASE.entryHigh) / (CASE.entryHigh - CASE.stopLoss);
    expect(view.netRiskReward).toBeLessThan(gross);
    expect(view.netRiskReward).toBeGreaterThan(0);
  });

  it('停損距離為零時不輸出 Infinity', () => {
    const view = planPositionFor({
      entryHigh: 100,
      stopLoss: 100,
      takeProfit: 115,
      riskPerLot: 1,
      settings,
    });
    expect(view.netRiskReward === null || Number.isFinite(view.netRiskReward)).toBe(true);
  });
});

/**
 * 一張 100 萬的股票配上預設設定（資金 100 萬、單檔上限 30%），
 * 整張路徑一定算出 0 張。這是零股接手的唯一情況。
 */
const ODD = { entryHigh: 1000, stopLoss: 915.4, takeProfit: 1200, firstTarget: 1050 };

describe('零股建議', () => {
  it('算得出整張時不給零股建議 —— 兩者互斥', () => {
    // 同一張卡片同時出現「買 3 張」與「買 250 股」的話，使用者不知道該照哪個做。
    const view = planPositionFor({
      entryHigh: CASE.entryHigh,
      stopLoss: CASE.stopLoss,
      takeProfit: CASE.takeProfit,
      firstTarget: CASE.firstTarget,
      riskPerLot: CASE.grossRiskPerLot,
      settings,
    });
    expect(view.position!.lots).toBeGreaterThan(0);
    expect(view.oddLot).toBeNull();
  });

  it('買不到 1 張時給出股數', () => {
    const view = planPositionFor({ ...ODD, settings: DEFAULT_RISK_SETTINGS });
    expect(view.position!.lots).toBe(0);
    expect(view.oddLot!.shares).toBe(222);
  });

  it('零股的最壞虧損同樣不超過使用者設定的單筆風險上限', () => {
    const view = planPositionFor({ ...ODD, settings: DEFAULT_RISK_SETTINGS });
    expect(view.oddLot!.risk).toBeLessThanOrEqual(DEFAULT_RISK_SETTINGS.riskBudget);
  });

  it('零股用的是進場區上緣，與整張路徑同一組基準', () => {
    const view = planPositionFor({ ...ODD, settings: DEFAULT_RISK_SETTINGS });
    expect(view.oddLot!.cost).toBe(view.oddLot!.shares * ODD.entryHigh);
  });
});
