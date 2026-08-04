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

  it('不受時分秒影響 —— 同一天的凌晨與深夜算出來一樣', () => {
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
