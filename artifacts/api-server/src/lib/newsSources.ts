/**
 * 新聞來源白名單，以及「這篇新聞是否真的在講目標標的」的判斷。
 *
 * 實測（2026-07-30）釐清的兩件事：
 *
 * 1. Tavily 的 include_domains 會確實生效，**不會**越過白名單。以單一難命中網域
 *    加無意義查詢測試，回傳的仍全部落在該網域內。因此 isAllowedNewsUrl 是防護網
 *    （萬一日後行為改變或白名單漏設），不是在修一個現行的漏洞。
 *
 * 2. 真正的失效模式是另一個：白名單內找不到相關內容時，Tavily 會回傳
 *    **白名單內但不相關**的文章。查「軌道扣件防蝕塗層」撈回 PCB 產業新聞，
 *    模型便據此選出欣興、弘塑等完全無關的標的。網域過濾對此無效 ——
 *    那些來源本來就在白名單裡。
 *
 * 對第 2 點先試過「標示而非丟棄」：在 prompt 裡把每篇標為「提及目標」或「僅供背景」，
 * 並明令不得依背景新聞推論供應鏈。**實測無效** —— 查「軌道扣件防蝕塗層」時模型
 * 照樣依 PCB 新聞給出欣興、弘塑，且未按指示說明「近期無相關報導」。
 * 內容本身的訊號壓過了指令。
 *
 * 因此改為不送出：完全不相關的新聞直接剔除，一篇都不剩就走「未找到近期新聞」
 * 分支讓模型改用既有知識。兩種錯誤不對等 —— 少給新聞只是少了參考，
 * 給錯新聞會產出一份自信但錯誤的供應鏈名單。
 */

/** 可信的台股財經來源；同時作為送出的 include_domains 與回傳的過濾條件 */
export const NEWS_DOMAINS = [
  "cnyes.com",
  "money.udn.com",
  "ctee.com.tw",
  "technews.tw",
  "finance.yahoo.com",
  "mops.twse.com.tw",
] as const;

/**
 * 網址是否屬於白名單網域。
 *
 * 比對主機名而非整串網址：白名單寫 cnyes.com 必須讓 news.cnyes.com 通過，
 * 但 cnyes.com.evil.example 不能通過，所以用「完全相等或以 .domain 結尾」判斷，
 * 而不是 includes()。
 */
export function isAllowedNewsUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // 解析不了的網址一律不信
  }

  return NEWS_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

/**
 * 個股新聞的查詢字串。
 *
 * **刻意不帶產業類別、「供應鏈」與「競爭對手」。** 先前的查詢是
 * `${名稱} ${代號} ${產業} 台股 供應鏈 競爭對手`，用意是順便撈出同業，
 * 實測（2026-08-05）卻是這樣：
 *
 * - `高技 5439 電子零組件業 台股 供應鏈 競爭對手` → 六筆全是工商時報
 *   「上詮」「燿華」「敬鵬」的**搜尋結果頁**與一篇 2023 年的 PCB 族群文，
 *   沒有一篇提到高技。標題比對於是全數剔除，畫面寫「近期無相關新聞報導」。
 * - `高技 5439 股價 營運` → 六筆全部命中，其中五篇是真報導
 *   （6 月營收創新高、Q3 賺回逾半個股本、AI 伺服器高階板放量……）。
 *
 * 尾巴那幾個詞的權重壓過了公司名，Tavily 因此回傳整個產業的泛論。
 * 同業由 prompt negotiate —— 那裡已經給了官方產業類別並要求從中挑 2~4 家，
 * 不需要靠搜尋字串去湊。
 *
 * 也試過 `topic: "news"`：回傳整頁 Palantir、Caterpillar 的美股英文新聞，
 * 完全無視中文查詢，比現況更糟。
 */
export function stockNewsQuery(stockName: string, stockId: string): string {
  return `${stockName} ${stockId} 股價 營運`;
}

/**
 * 這個網址是一篇報導，還是行情頁。
 *
 * 個股查詢會撈回一批「標題有公司名與代號、但根本不是新聞」的頁面：
 * 鉅亨的個股總覽、工商時報的行情頁、Yahoo 的財務統計、TechNews 的統一編號頁、
 * 以及各家的搜尋結果頁。它們通過網域白名單也通過標題比對，卻佔掉四個名額之一，
 * 而且印在「參考新聞」時是一個點不出東西的連結。
 *
 * 用排除法而非「路徑必須含 /news/」：technews.tw 的報導網址是
 * `technews.tw/2026/07/09/slug/`，正面表列會把它一起擋掉。
 * 這裡的錯誤代價不對等 —— 漏擋一個行情頁只是浪費一格，
 * 誤擋一篇真報導則是把這次分析唯一的依據丟掉。
 */
const NON_ARTICLE_PATTERNS = [
  "/search/",
  "/quote/",
  "/twstock/",
  "/market-stock/",
  "/company/",
  "key-statistics",
] as const;

export function isNewsArticleUrl(url: string): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return false; // 解析不了的網址一律不信，與 isAllowedNewsUrl 同一個立場
  }

  return !NON_ARTICLE_PATTERNS.some((pattern) => path.includes(pattern));
}

/**
 * 命中的比對詞數量。
 *
 * 純數字的詞（股票代號）必須前後不接數字才算命中：把「8111」當子字串比對時，
 * 「台股收在 28111 點」也會命中，導致大盤摘要被當成立碁的新聞留下來 ——
 * 實測確實發生過。其餘詞做單純的包含比對。
 *
 * 回傳數量而非布林值，讓呼叫端能以「命中幾個」排序：命中 2 個詞的報導
 * 比命中 1 個的更可能真的在講這個主題，這是排序依據，不是及格門檻。
 */
export function countMatches(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  const seen = new Set<string>();

  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    if (term.length === 0 || seen.has(term)) continue;

    const hit = /^\d+$/.test(term)
      ? new RegExp(`(?<!\\d)${term}(?!\\d)`).test(haystack)
      : haystack.includes(term);

    if (hit) seen.add(term);
  }
  return seen.size;
}

/** 是否命中任一比對詞。門檻只有「至少一個」—— 唯一不需要調參的選擇。 */
export function mentionsTarget(text: string, terms: string[]): boolean {
  return countMatches(text, terms) > 0;
}

/**
 * 把關鍵字拆成比對用的詞：所有連續兩字組合。
 *
 * 為什麼是兩字：中文的最小有意義單位是兩字詞，整串比對太嚴
 * （「AI水冷散熱」會漏掉標題寫「液冷散熱」的相關報導），單字比對太鬆
 * （「電」「子」幾乎命中所有財經新聞）。取兩字組合則
 * 「液冷散熱需求爆發」命中「散熱」而保留，PCB 新聞不含任何一組而剔除。
 *
 * 空白與標點先去除，避免產生跨詞的無意義組合。
 */
export function keywordTerms(keyword: string): string[] {
  const cleaned = keyword.replace(/[\s\p{P}\p{S}]+/gu, "");
  if (cleaned.length === 0) return [];
  if (cleaned.length <= 2) return [cleaned];

  const grams = new Set<string>();
  for (let i = 0; i + 2 <= cleaned.length; i++) {
    grams.add(cleaned.slice(i, i + 2));
  }
  return [...grams];
}
