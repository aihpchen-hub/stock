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

/** 抓取失敗的原因。額度用盡必須與其他失敗分得開 —— 它是可預期的常態。 */
export type FinMindFailure = "rate_limited" | "http" | "network";

export type FinMindResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: FinMindFailure };

/**
 * 抓資料，並且**說得出自己有沒有成功**。
 *
 * 先前只有 `fetchFinMind`，任何失敗都回空陣列，於是「這檔今天沒有法人買賣超」
 * 與「我們沒抓到」在型別上完全相同。免費層一小時 300~600 次而一次分析
 * 五檔就要發二三十個請求，額度用盡是常態不是例外 —— 結果是評分少算了
 * 營收與籌碼兩項（evScore 從 5.5 掉到 0），畫面卻只印出一個看起來完全正常的
 * 精確 E(V)，然後那份被稀釋過的結果還會被寫進當日快取供應一整天。
 *
 * 一律不丟例外：單一資料集抓不到時，其他資料集算出來的部分仍然有價值。
 * 但呼叫端現在有能力區分，因此可以決定「這種缺失能不能快取」。
 */
export async function fetchFinMindResult<T>(url: string): Promise<FinMindResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    // 逾時、DNS 失敗、連線中斷。先前這裡讓例外冒泡，整支 /api/stock 回 500，
    // 而前端的卡片會永遠停在載入骨架上。
    return { ok: false, reason: "network" };
  }

  // FinMind 額度用盡時回 402；429 是一般性的速率限制
  if (res.status === 402 || res.status === 429) return { ok: false, reason: "rate_limited" };
  if (!res.ok) return { ok: false, reason: "http" };

  let json: FinMindResponse<T>;
  try {
    json = (await res.json()) as FinMindResponse<T>;
  } catch {
    // 上游回了 HTML 錯誤頁而非 JSON
    return { ok: false, reason: "http" };
  }

  // 有時是 HTTP 200 包一個 402 的內文
  if (json.status === 402) return { ok: false, reason: "rate_limited" };
  if (json.status !== 200) return { ok: false, reason: "http" };
  return { ok: true, rows: json.data ?? [] };
}

/**
 * 只要資料列、不在乎失敗原因的呼叫端用這個。
 *
 * 適用於「少了它畫面整塊不渲染」的資料（大盤脈絡、前瞻驗證的日線），
 * 那些地方缺資料本來就有明確的呈現方式。會影響評分的資料集請改用
 * `fetchFinMindResult` —— 少算一項而不說，比整塊不顯示嚴重得多。
 */
export async function fetchFinMind<T>(url: string): Promise<T[]> {
  const r = await fetchFinMindResult<T>(url);
  return r.ok ? r.rows : [];
}
