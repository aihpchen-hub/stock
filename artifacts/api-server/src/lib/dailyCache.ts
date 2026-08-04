/**
 * 以「日」為單位的快取。
 *
 * Gemini 免費額度是最主要的使用限制，而同一個關鍵字在同一天重複查詢
 * （回上一頁、比較不同標的、單純再看一次）本來就該得到同一份結果 ——
 * 分析週期是 1~6 個月，同一天內的新聞增量對結論沒有意義。
 *
 * 附帶好處：同日同查詢變成完全確定性，不會因模型採樣而給出不同名單。
 * 代價：當天出現重大消息不會反映，需隔日才會更新。以本工具的時間尺度可接受。
 *
 * 資料放哪裡由傳入的 CacheStore 決定（見 cacheStore.ts）—— 這支只負責
 * 「這筆是不是今天的」，因此不論記憶體或 Netlify Blobs 都是同一套邏輯。
 */

import type { CacheStore } from "./cacheStore";

export interface DailyCache<T> {
  /** 取值；不存在、非當日或資料損毀都回傳 null */
  get(key: string, day: string): Promise<T | null>;
  set(key: string, day: string, value: T): Promise<void>;
}

interface Envelope<T> {
  day: string;
  value: T;
}

/**
 * 日期與值一起存，而不是把日期編進鍵裡。
 *
 * 編進鍵裡的話，舊日資料會以不同鍵永久留著，而 Blobs 上沒有任何機制會去清它。
 * 存在同一個鍵上，隔日的第一次寫入就直接覆蓋掉舊值。
 */
export function createDailyCache<T>(store: CacheStore): DailyCache<T> {
  return {
    async get(key, day) {
      const raw = await store.get(key);
      if (raw === null) return null;

      let parsed: Envelope<T>;
      try {
        parsed = JSON.parse(raw) as Envelope<T>;
      } catch {
        // 損毀的項目當成沒命中；下一次成功的請求會覆蓋掉它。
        return null;
      }

      if (parsed?.day !== day) return null;
      return parsed.value;
    },

    async set(key, day, value) {
      await store.set(key, JSON.stringify({ day, value } satisfies Envelope<T>));
    },
  };
}

/** 關鍵字大小寫與前後空白不該產生不同的快取項 */
export function analysisCacheKey(keyword: string, period: string): string {
  return `analysis|${keyword.trim().toLowerCase()}|${period}`;
}

/**
 * 個股資料以「代號＋週期」為鍵 —— 不同週期算出來的交易計畫不同。
 *
 * 版本前綴針對的是部署當天：快取雖然以日失效，但當天稍早寫入的 payload
 * 是舊版程式產生的，缺少新欄位。沒有版本前綴時，使用者會拿到少一截欄位的
 * 回應直到隔天 —— 而畫面對缺欄位的處理是整塊不渲染，看起來就像功能沒上線。
 * 改版時遞增此處的版本號即可讓舊項目自然失效。
 */
export function stockCacheKey(code: string, period: string): string {
  return `stock|v6|${code.trim().toLowerCase()}|${period}`;
}

/**
 * 財報資料的快取鍵。
 *
 * 不帶週期：財報與使用者選的持有期無關。仍以日失效即可 —— 財報是季頻，
 * 多抓幾次無妨；少抓才是問題（發布當天拿到舊資料）。
 */
export function fundamentalsCacheKey(code: string): string {
  return `fundamentals|v1|${code.trim().toLowerCase()}`;
}

/**
 * 大盤脈絡的快取鍵。
 *
 * 與個股分開存是關鍵：一次分析要查 3~5 檔，若在每檔的流程裡各抓一次
 * 加權指數，就是每次分析多 3~5 個 FinMind 請求。獨立成一個以日為單位的
 * 項目之後，當天第一檔查詢抓一次、其餘全部命中快取 —— 實際成本是
 * 每日 +1 個請求。
 *
 * 不帶週期：大盤脈絡與使用者選的持有期無關，帶了只會讓同一份資料
 * 被存三遍並各抓一次。
 */
export function marketCacheKey(): string {
  return "market|v1|TAIEX";
}

/** 當日日期字串（YYYY-MM-DD，本地時區）—— 使用者的「今天」以本地為準 */
export function today(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
