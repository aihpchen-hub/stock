/**
 * 新聞距今多久。
 *
 * 一則標題無法自證新舊。實測（2026-08-05）查正文 4906 時，搜尋結果混進一篇
 * 2023 年 8 月的工商時報報導，與當月的新聞並排在「參考新聞」裡，畫面上沒有
 * 任何一個字說明它是三年前的東西 —— 而那份分析的依據裡就有它。
 */

/**
 * 超過這個天數視為過舊。
 *
 * 與後端 prompt 裡「距今超過半年的報導不得當作近期發展陳述」是同一個門檻。
 * 兩邊各寫一個數字遲早會分岔，而分岔的結果是模型忽略某篇、畫面卻沒標示它舊。
 */
export const STALE_DAYS = 180;

export interface NewsAge {
  /** 「今天」「3 天前」「2 年前」 */
  text: string;
  /** 超過 STALE_DAYS。畫面據此改樣式 */
  stale: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 回傳距今多久，日期缺席或格式不對時回 null。
 *
 * **不以查詢時間充數。** 抓不到發布日期時畫面就不顯示時間 —— 印一個
 * 「今天」而它其實是三年前的報導，比不印嚴重得多。
 */
export function newsAge(
  publishedAt: string | null | undefined,
  now: Date = new Date(),
): NewsAge | null {
  if (!publishedAt || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) return null;

  const then = new Date(`${publishedAt}T00:00:00`);
  if (Number.isNaN(then.getTime())) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // 來源與本地的時區差可能讓發布日看起來比今天晚一天。負數一律當今天，
  // 不顯示「-1 天前」那種只會讓人懷疑整個畫面的東西。
  const days = Math.max(0, Math.round((today.getTime() - then.getTime()) / DAY_MS));

  return { text: describe(days), stale: days > STALE_DAYS };
}

function describe(days: number): string {
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  // 一個月內改以週計：「23 天前」對判斷新舊沒有比「3 週前」多說什麼
  if (days < 30) return `${Math.floor(days / 7)} 週前`;
  if (days < 365) return `${Math.floor(days / 30)} 個月前`;
  return `${Math.floor(days / 365)} 年前`;
}
