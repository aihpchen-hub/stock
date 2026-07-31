/**
 * 台股基本資料查詢（證交所／櫃買中心，經 FinMind 提供）。
 *
 * 這是唯一具權威性的名稱與產業別來源。模型給的名稱與產業描述無法查核，
 * 因此兩條路由都以此為對照：analyze 用來消除代碼歧義，stock 用來讓前端
 * 能把官方值與模型描述並列。
 */

const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";

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
export async function resolveStock(code: string): Promise<StockInfoRow | null> {
  const token = process.env["FINMIND_TOKEN"];
  const params = new URLSearchParams({ dataset: "TaiwanStockInfo", data_id: code });
  if (token) params.set("token", token);

  try {
    const res = await fetch(`${FINMIND_BASE}?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: StockInfoRow[] };
    const row = json.data?.[0];
    return row?.stock_name ? row : null;
  } catch {
    return null;
  }
}
