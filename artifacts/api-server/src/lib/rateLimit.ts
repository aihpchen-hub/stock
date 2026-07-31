/**
 * 每日配額 —— 保護的是 Gemini 與 Tavily 的免費額度，不是安全邊界。
 *
 * 部署到公開網域之後，`/api/analyze` 就變成任何人都能呼叫的端點，而它每次
 * 未命中快取就燒一次 Gemini。沒有這一層的話，一支迴圈腳本可以在幾分鐘內
 * 把當天的額度打光，而你只會看到「分析失敗」。
 *
 * 刻意說清楚它不是什麼：
 * - **不是防 DDoS**：那要在 CDN 層做，應用層擋不住。
 * - **不是精準計數**：Blobs 沒有原子遞增，兩個並行請求可能讀到同一個值後
 *   各自加一，於是少算一次。放行幾次不影響「擋住持續濫用」這個目的，
 *   而為了精準去引入外部依賴（Redis）並不划算。
 * - **不是身分驗證**：IP 可以換。它擋的是隨手寫的腳本，不是有心人。
 */

import type { CacheStore } from "./cacheStore";

/** 單一 IP 每日可觸發幾次昂貴分析。以個人使用而言遠遠夠用。 */
export const DEFAULT_DAILY_LIMIT = 40;

export interface QuotaResult {
  allowed: boolean;
  /** 這次之後已用掉幾次 */
  used: number;
  limit: number;
}

interface Counter {
  day: string;
  count: number;
}

/**
 * 記一次用量並回報是否放行。
 *
 * 計數與配額判斷放在同一個函式，呼叫端就不可能「查了卻忘記記」。
 */
export async function consumeDailyQuota(
  store: CacheStore,
  identity: string,
  day: string,
  limit = DEFAULT_DAILY_LIMIT,
): Promise<QuotaResult> {
  const key = `quota|${day}|${identity}`;

  let current: Counter | null = null;
  const raw = await store.get(key);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Counter;
      if (parsed?.day === day && typeof parsed.count === "number") current = parsed;
    } catch {
      // 損毀就當作沒用過 —— 寧可放行，也不要因為一筆壞資料把使用者鎖在門外。
    }
  }

  const used = (current?.count ?? 0) + 1;

  // 超過上限後不再寫入：擋下來的請求不該把計數推得更高，
  // 否則被擋的人會看到一個持續膨脹、毫無意義的數字。
  if (used > limit) {
    return { allowed: false, used: current?.count ?? 0, limit };
  }

  await store.set(key, JSON.stringify({ day, count: used } satisfies Counter));
  return { allowed: true, used, limit };
}

/**
 * 取出呼叫端 IP。
 *
 * Netlify 會把真實來源放在 x-nf-client-connection-ip；一般代理則用
 * x-forwarded-for 的第一段。兩者都沒有時退回 Express 的 req.ip
 * （本機開發就是這種情況）。
 *
 * 標頭可以偽造，所以這只是「盡力而為」的識別 —— 見本檔開頭的說明。
 */
export function clientIdentity(headers: Record<string, unknown>, fallback?: string): string {
  const direct = headers["x-nf-client-connection-ip"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return fallback?.trim() || "unknown";
}
