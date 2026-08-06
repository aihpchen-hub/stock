import { describe, expect, it } from 'vitest';

import { EMPTY, formatLots, formatNTD, formatSignedPct, formatVolumeLots } from './format';

describe('缺值符號', () => {
  it('全站只有一種寫法', () => {
    // 先前同一張卡片上半形 '-' 與全形 '—' 混用：均線位置用 '-'、
    // 相對強弱用 '—'、成交量用 '-'。三個都表示「沒有資料」。
    expect(EMPTY).toBe('—');
  });

  it('null、undefined、NaN、Infinity 一律是缺值', () => {
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatLots(bad)).toBe(EMPTY);
      expect(formatSignedPct(bad)).toBe(EMPTY);
      expect(formatNTD(bad)).toBe(EMPTY);
    }
  });
});

describe('formatLots 法人買賣超', () => {
  it('以張為單位並加千分位', () => {
    // 先前 stock-card 的版本沒有千分位（「+23456張」），
    // chips-panel 的版本有 —— 同一個數字兩種樣子。
    expect(formatLots(23_456_000)).toBe('+23,456張');
    expect(formatLots(-23_456_000)).toBe('-23,456張');
  });

  it('零是有效資料，不是缺值', () => {
    // 先前 stock-card 寫 `if (!qty) return '-'`，把「法人今天沒動作」
    // 顯示成「沒有資料」。
    expect(formatLots(0)).toBe('0張');
  });

  it('不足一張時不會印出負零', () => {
    // Math.round(-0.4) 是 -0，樣板字串會印成「-0張」
    expect(formatLots(-400)).toBe('0張');
    expect(formatLots(400)).toBe('0張');
  });
});

describe('formatVolumeLots 成交量', () => {
  it('以張為單位並加千分位', () => {
    expect(formatVolumeLots(12_345_678)).toBe('12,346張');
  });

  it('零與負值視為無意義', () => {
    expect(formatVolumeLots(0)).toBe(EMPTY);
    expect(formatVolumeLots(-100)).toBe(EMPTY);
  });
});

describe('formatSignedPct 百分比', () => {
  it('正數帶加號、負數帶減號', () => {
    expect(formatSignedPct(3.42)).toBe('+3.4%');
    expect(formatSignedPct(-1.87)).toBe('-1.9%');
  });

  it('四捨五入後為零時不帶正負號', () => {
    // 先前 (-0.04).toFixed(1) 得到 '-0.0'，畫面印出「-0.0%」
    // 還配上紅色下跌箭頭 —— 那其實是打平。
    expect(formatSignedPct(-0.04)).toBe('0.0%');
    expect(formatSignedPct(0.04)).toBe('0.0%');
    expect(formatSignedPct(0)).toBe('0.0%');
  });

  it('可指定小數位', () => {
    expect(formatSignedPct(3.456, 2)).toBe('+3.46%');
    expect(formatSignedPct(-0.001, 2)).toBe('0.00%');
  });
});

describe('formatNTD 金額', () => {
  it('小額直接給整數加千分位', () => {
    expect(formatNTD(285_000)).toBe('285,000');
    expect(formatNTD(1234.6)).toBe('1,235');
  });

  it('億以上換算成億並保留兩位', () => {
    expect(formatNTD(1_234_500_000, { compact: true })).toBe('12.35億');
  });

  it('中小型股的自由現金流不會塌成 0.0 億', () => {
    // 先前固定除以一億再取一位小數，一家季自由現金流 3,200 萬的公司
    // 會印出「0.3 億」，1,200 萬的印出「0.1 億」，400 萬的印出「0.0 億」，
    // 而虧損 400 萬的印出「-0.0 億」。
    expect(formatNTD(4_000_000, { compact: true })).toBe('400萬');
    expect(formatNTD(-4_000_000, { compact: true })).toBe('-400萬');
    expect(formatNTD(32_000_000, { compact: true })).toBe('3,200萬');
  });

  it('零就是零', () => {
    expect(formatNTD(0, { compact: true })).toBe('0');
  });
});
