/**
 * 台股基本資料查詢（證交所／櫃買中心，經 FinMind 提供）。
 *
 * 這是唯一具權威性的名稱與產業別來源。模型給的名稱與產業描述無法查核，
 * 因此兩條路由都以此為對照：analyze 用來消除代碼歧義，stock 用來讓前端
 * 能把官方值與模型描述並列。
 */

import { dailyCacheFor } from "./caches";
import { stockInfoCacheKey, today } from "./dailyCache";
import { FINMIND_BASE, fetchFinMindResult } from "./finmind";

export interface StockInfoRow {
  industry_category: string;
  stock_id: string;
  stock_name: string;
  type: string;
}

/** 四到六位純數字視為台股代號 */
export function isStockCode(keyword: string): boolean {
  return /^\d{4,6}$/.test(keyword);
}

/**
 * 把代號解析成公司名稱與官方產業別。
 *
 * 少了這一步，搜尋「8111」會撈到美國佛州法案與亞特蘭大的康復中心，
 * 模型便順著那些新聞把立碁判成生技股。
 * 查不到（代號無效或 API 失敗）時回傳 null，讓呼叫端自行降級處理。
 */
const infoCache = dailyCacheFor<StockInfoRow>();

export async function resolveStock(code: string): Promise<StockInfoRow | null> {
  const cacheKey = stockInfoCacheKey(code);
  const day = today();

  const cached = await infoCache.get(cacheKey, day);
  if (cached) return cached;

  const token = process.env["FINMIND_TOKEN"];
  const params = new URLSearchParams({ dataset: "TaiwanStockInfo", data_id: code });
  if (token) params.set("token", token);

  const result = await fetchFinMindResult<StockInfoRow>(`${FINMIND_BASE}?${params}`);
  if (!result.ok) return null;

  const row = result.rows[0];
  if (!row?.stock_name) return null;

  // 只快取查得到的結果。查不到可能是暫時性的（額度用盡、上游異常），
  // 把 null 鎖成當天的答案會讓一檔正常的股票整天都顯示不出官方名稱 ——
  // 而那正是「模型把立碁判成生技股」那個坑的防線。
  await infoCache.set(cacheKey, day, row);
  return row;
}
