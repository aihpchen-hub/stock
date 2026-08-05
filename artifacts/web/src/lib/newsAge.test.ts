import { describe, expect, it } from 'vitest';

import { newsAge, STALE_DAYS } from './newsAge';

const NOW = new Date('2026-08-05T12:00:00+08:00');

describe('新聞距今多久', () => {
  it('同一天是今天', () => {
    expect(newsAge('2026-08-05', NOW)?.text).toBe('今天');
  });

  it('前一天是昨天', () => {
    expect(newsAge('2026-08-04', NOW)?.text).toBe('昨天');
  });

  it('一週內以天計', () => {
    expect(newsAge('2026-08-02', NOW)?.text).toBe('3 天前');
  });

  it('一個月內以週計 —— 「23 天前」對判斷沒有比「3 週前」多說什麼', () => {
    expect(newsAge('2026-07-13', NOW)?.text).toBe('3 週前');
  });

  it('一年內以月計', () => {
    expect(newsAge('2026-05-05', NOW)?.text).toBe('3 個月前');
  });

  it('超過一年以年計 —— 實測搜尋結果混進過 2023 年的報導', () => {
    expect(newsAge('2023-08-25', NOW)?.text).toBe('2 年前');
  });

  it('超過半年標為過舊，讓畫面能給它不同的樣子', () => {
    expect(newsAge('2026-08-05', NOW)?.stale).toBe(false);
    expect(newsAge('2026-01-05', NOW)?.stale).toBe(true);
  });

  it('半年的門檻與後端 prompt 用的是同一個數字', () => {
    expect(STALE_DAYS).toBe(180);
  });

  it('缺日期或格式不對時回 null —— 不以查詢時間充數', () => {
    expect(newsAge(null, NOW)).toBeNull();
    expect(newsAge(undefined, NOW)).toBeNull();
    expect(newsAge('', NOW)).toBeNull();
    expect(newsAge('不是日期', NOW)).toBeNull();
  });

  it('日期在未來時當作今天，不顯示「-3 天前」', () => {
    // 時區差可能讓來源的日期比本地時間早一天
    expect(newsAge('2026-08-07', NOW)?.text).toBe('今天');
  });
});
