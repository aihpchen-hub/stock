/**
 * FinMind 資料存取的共用部分。
 *
 * 抽出來是因為第二個路由（前瞻驗證）也要抓同一個 TaiwanStockPrice 資料集。
 * 兩份各自維護的 fetch 很容易在超時、錯誤處理或 token 傳遞上長歪。
 */

export const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";

export interface FinMindResponse<T> {
  msg: string;
  status: number;
  data: T[];
}

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dateMinusDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export function dateMinusMonths(months: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

export function buildUrl(
  dataset: string,
  dataId: string,
  startDate: Date | string,
  token?: string,
): string {
  const start = typeof startDate === "string" ? startDate : toDateStr(startDate);
  const p = new URLSearchParams({ dataset, data_id: dataId, start_date: start });
  if (token) p.set("token", token);
  return `${FINMIND_BASE}?${p}`;
}

/**
 * 抓資料；失敗一律回空陣列，讓呼叫端以「資料不足」處理。
 *
 * 刻意不丟例外：單一資料集抓不到時，其他資料集算出來的部分仍然有價值，
 * 整個請求失敗反而讓使用者什麼都看不到。
 */
export async function fetchFinMind<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const json = (await res.json()) as FinMindResponse<T>;
  if (json.status !== 200) return [];
  return json.data ?? [];
}
