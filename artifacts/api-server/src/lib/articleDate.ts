/**
 * 新聞的發布時間。
 *
 * 為什麼要多抓一次頁面：Tavily 的一般搜尋**不回傳** `published_date`
 * （實測 2026-08-05，回傳欄位只有 url／title／content／score／raw_content／id），
 * 而唯一會帶日期的 `topic: "news"` 模式會回一整頁 Palantir、Caterpillar 的
 * 美股英文新聞，完全無視中文查詢。兩條路都不通。
 *
 * 為什麼非要日期不可：實測查正文 4906 時，結果裡混著一篇 2023 年 8 月的
 * 工商時報報導，與今年的新聞並列送進模型，且畫面上沒有一個字說明它是舊聞。
 * 這不只是體驗問題 —— 那份分析的依據裡有一篇三年前的東西。
 *
 * 三家主力來源都讀得到（實測）：
 * - 鉅亨網：`article:published_time` 與 ld+json
 * - 工商時報：`article:published_time`、`itemprop`、ld+json、`pubdate` 四種都給
 * - 經濟日報：只給 ld+json 的 `datePublished`
 */

/**
 * 依序嘗試的標記。文章自己的 meta 排在 ld+json 之前 ——
 * ld+json 有時描述的是整個網站或列表頁而非這一篇。
 */
const PATTERNS: RegExp[] = [
  /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
  /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
  /"datePublished"\s*:\s*"([^"]+)"/i,
];

/**
 * 從 HTML 抽出發布日期（YYYY-MM-DD）。抓不到或不是合法日期時回 null。
 *
 * 只取到日，不取到時分：新聞頁給的時區標示並不一致（工商時報給
 * `2026-07-09 18:41:42` 不帶時區、鉅亨給 UTC），硬要精確到小時只會製造
 * 一個看起來精確、實際上差八小時的數字。而使用者要的是「多久以前」。
 */
export function extractPublishedAt(html: string): string | null {
  for (const pattern of PATTERNS) {
    const raw = html.match(pattern)?.[1];
    if (!raw) continue;

    // 不帶時區的「YYYY-MM-DD HH:mm:ss」在部分執行環境會解析失敗，
    // 而我們只要日期 —— 前十碼本身就是答案，先直接取。
    const head = raw.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(head) && !Number.isNaN(Date.parse(head))) {
      return head;
    }
  }
  return null;
}

/** 單篇的抓取結果 */
export interface ArticleDate {
  url: string;
  publishedAt: string | null;
}

/**
 * 併發抓取多篇的發布日期。
 *
 * 任何一篇失敗（逾時、擋爬、改版）都只讓那一篇的日期為 null，
 * 不影響其他篇，更不會讓整個分析失敗 —— 日期是附加資訊，
 * 拿不到就不顯示，不值得為它中斷一次要花 16~20 秒的分析。
 *
 * 這些請求只在快取未命中時發生，同關鍵字同日只會跑一次。
 */
export async function fetchPublishedDates(
  urls: string[],
  timeoutMs = 6000,
): Promise<ArticleDate[]> {
  return Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: {
            // 不帶 UA 時部分站台直接回 403
            "User-Agent":
              "Mozilla/5.0 (compatible; TaiwanStockAnalyzer/1.0; +https://github.com/aihpchen-hub/stock)",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return { url, publishedAt: null };
        return { url, publishedAt: extractPublishedAt(await res.text()) };
      } catch {
        return { url, publishedAt: null };
      }
    }),
  );
}
