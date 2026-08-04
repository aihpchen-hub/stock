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
