import { beforeEach, describe, expect, it } from 'vitest';

import stub from '../../../../test/localStorageStub';
import {
  DEFAULT_CAPITAL,
  DEFAULT_FEE_DISCOUNT,
  DEFAULT_MAX_POSITION_PCT,
  DEFAULT_RISK_BUDGET,
  loadCapital,
  loadFeeDiscount,
  loadMaxPositionPct,
  loadRiskBudget,
  loadRiskSettings,
  planPosition,
  saveCapital,
  saveFeeDiscount,
  saveMaxPositionPct,
  saveRiskBudget,
} from './settings';

beforeEach(() => stub.__reset());

describe('風險預算存讀', () => {
  it('未設定過時回傳預設值', async () => {
    expect(await loadRiskBudget()).toBe(DEFAULT_RISK_BUDGET);
    expect(await loadCapital()).toBe(DEFAULT_CAPITAL);
    expect(await loadMaxPositionPct()).toBe(DEFAULT_MAX_POSITION_PCT);
    expect(await loadFeeDiscount()).toBe(DEFAULT_FEE_DISCOUNT);
  });

  it('存了之後讀得回來', async () => {
    await saveRiskBudget(55000);
    await saveCapital(3_000_000);
    await saveMaxPositionPct(0.5);
    await saveFeeDiscount(0.28);
    expect(await loadRiskSettings()).toEqual({
      riskBudget: 55000,
      capital: 3_000_000,
      maxPositionPct: 0.5,
      feeDiscount: 0.28,
    });
  });

  it('拒絕零與負數，維持原值', async () => {
    await saveRiskBudget(30000);
    await saveRiskBudget(0);
    await saveRiskBudget(-5);
    expect(await loadRiskBudget()).toBe(30000);
  });

  it('儲存時取整數', async () => {
    await saveRiskBudget(1234.7);
    expect(await loadRiskBudget()).toBe(1235);
  });

  it('資料損毀時退回預設值而非崩潰', async () => {
    stub.__seed('risk_budget_per_trade_v1', 'not-a-number');
    stub.__seed('max_position_pct_v1', 'garbage');
    expect(await loadRiskBudget()).toBe(DEFAULT_RISK_BUDGET);
    expect(await loadMaxPositionPct()).toBe(DEFAULT_MAX_POSITION_PCT);
  });

  it('單檔上限拒絕超出 1%~100% 的值', async () => {
    await saveMaxPositionPct(0.4);
    await saveMaxPositionPct(1.5); // 150% 應被拒
    await saveMaxPositionPct(0); // 0% 應被拒
    expect(await loadMaxPositionPct()).toBe(0.4);
  });

  it('已存的上限若超出範圍，讀取時退回預設值', async () => {
    stub.__seed('max_position_pct_v1', '9');
    expect(await loadMaxPositionPct()).toBe(DEFAULT_MAX_POSITION_PCT);
  });

  it('手續費折扣拒絕超出 1 折~無折扣的值', async () => {
    await saveFeeDiscount(0.6);
    await saveFeeDiscount(1.2); // 比牌告還貴，應被拒
    await saveFeeDiscount(0.05); // 0.5 折不合實際，應被拒
    await saveFeeDiscount(0);
    expect(await loadFeeDiscount()).toBe(0.6);
  });

  it('已存的折扣若超出範圍，讀取時退回無折扣（保守）', async () => {
    stub.__seed('fee_discount_v1', '0.01');
    expect(await loadFeeDiscount()).toBe(DEFAULT_FEE_DISCOUNT);
  });
});

describe('planPosition 雙重限制', () => {
  it('風險較嚴時由風險決定張數', () => {
    // 每張風險 9260，預算 20000 -> 2 張；資金面允許更多
    const p = planPosition({
      riskBudget: 20000,
      capital: 10_000_000,
      riskPerLot: 9260,
      entryPrice: 62.6,
    });
    expect(p?.lots).toBe(2);
    expect(p?.limitedBy).toBe('risk');
  });

  it('資金較嚴時由資金決定張數', () => {
    // 每張風險僅 3000（風險面可買 6 張），但一張要 48.5 萬，
    // 100 萬的 30% = 30 萬，連一張都買不起
    const p = planPosition({
      riskBudget: 20000,
      capital: 1_000_000,
      riskPerLot: 3000,
      entryPrice: 485.5,
    });
    expect(p?.lots).toBe(0);
    expect(p?.limitedBy).toBe('capital');
  });

  it('永遠無條件捨去，不因進位超出上限', () => {
    // 20000 / 7000 = 2.857
    const p = planPosition({ riskBudget: 20000, capital: 100_000_000, riskPerLot: 7000, entryPrice: 10 });
    expect(p?.lots).toBe(2);
    expect(p!.risk).toBeLessThanOrEqual(20000);
  });

  it('實際投入不超過單檔上限', () => {
    const capital = 5_000_000;
    const p = planPosition({ riskBudget: 10_000_000, capital, riskPerLot: 1, entryPrice: 100 });
    expect(p!.cost).toBeLessThanOrEqual(capital * DEFAULT_MAX_POSITION_PCT);
  });

  it('可自訂單檔上限，調高後買得更多', () => {
    const common = { riskBudget: 10_000_000, capital: 1_000_000, riskPerLot: 1, entryPrice: 100 };
    // 一張 10 萬：上限 30% -> 30萬/10萬 = 3 張；上限 60% -> 6 張
    expect(planPosition({ ...common, maxPositionPct: 0.3 })?.lots).toBe(3);
    expect(planPosition({ ...common, maxPositionPct: 0.6 })?.lots).toBe(6);
    expect(planPosition({ ...common, maxPositionPct: 1 })?.lots).toBe(10);
  });

  it('自訂上限也會反映在 capitalCap 與佔比', () => {
    const p = planPosition({
      riskBudget: 10_000_000,
      capital: 1_000_000,
      riskPerLot: 1,
      entryPrice: 100,
      maxPositionPct: 0.5,
    });
    expect(p?.capitalCap).toBe(500_000);
    expect(p?.pctOfCapital).toBeCloseTo(50, 5);
  });

  it('超出範圍的上限退回預設值，不會意外全押', () => {
    const common = { riskBudget: 10_000_000, capital: 1_000_000, riskPerLot: 1, entryPrice: 100 };
    const fallback = planPosition({ ...common, maxPositionPct: 0.3 })?.lots;
    expect(planPosition({ ...common, maxPositionPct: 5 })?.lots).toBe(fallback);
    expect(planPosition({ ...common, maxPositionPct: 0 })?.lots).toBe(fallback);
    expect(planPosition({ ...common, maxPositionPct: Number.NaN })?.lots).toBe(fallback);
  });

  it('回報佔資金比重', () => {
    const p = planPosition({
      riskBudget: 1_000_000,
      capital: 10_000_000,
      riskPerLot: 100_000,
      entryPrice: 1000,
    });
    // 風險面 10 張，資金面 300萬/100萬 = 3 張 -> 取 3 張，投入 300 萬 = 30%
    expect(p?.lots).toBe(3);
    expect(p?.pctOfCapital).toBeCloseTo(30, 5);
  });

  it('缺少必要輸入時回傳 null，不給誤導的建議', () => {
    expect(planPosition({ riskBudget: 20000, capital: 1_000_000, riskPerLot: null, entryPrice: 100 })).toBeNull();
    expect(planPosition({ riskBudget: 20000, capital: 1_000_000, riskPerLot: 0, entryPrice: 100 })).toBeNull();
    expect(planPosition({ riskBudget: 20000, capital: 1_000_000, riskPerLot: 500, entryPrice: null })).toBeNull();
    expect(planPosition({ riskBudget: 0, capital: 1_000_000, riskPerLot: 500, entryPrice: 100 })).toBeNull();
    expect(planPosition({ riskBudget: 20000, capital: 0, riskPerLot: 500, entryPrice: 100 })).toBeNull();
  });
});
