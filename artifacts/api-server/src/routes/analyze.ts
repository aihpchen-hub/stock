import { Router } from "express";

import { dailyCacheFor, quotaStore } from "../lib/caches";
import { analysisCacheKey, today } from "../lib/dailyCache";
import { clientIdentity, consumeDailyQuota } from "../lib/rateLimit";
import { describeGeminiFailure } from "../lib/geminiErrors";
import {
  NEWS_DOMAINS,
  countMatches,
  isAllowedNewsUrl,
  isNewsArticleUrl,
  keywordTerms,
  newsSourceName,
  stockNewsQuery,
} from "../lib/newsSources";
import { fetchPublishedDates } from "../lib/articleDate";
import { isStockCode, resolveStock } from "../lib/stockInfo";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = Router();

interface AnalyzePayload {
  keyword: string;
  period: string;
  sentiment: string;
  summary: string;
  catalysts: string[];
  catalystDetails: SourcedClaim[];
  stocks: NonNullable<AiAnalysis["stocks"]>;
  newsItems: Array<{
    title: string;
    url: string;
    /** 讀者認得的媒體名稱。網址解析不了時為 null */
    source: string | null;
    /** 發布日期 YYYY-MM-DD。抓不到時為 null —— 不猜 */
    publishedAt: string | null;
  }>;
}

/** 同關鍵字同週期同日只打一次外部 API，省下有限的 Gemini 額度 */
const analysisCache = dailyCacheFor<AnalyzePayload>();

/**
 * 送進 prompt 與回傳給前端的新聞篇數 —— 必須是同一個數字。
 * 模型引註的編號要能對到畫面上真的看得到的那幾篇。
 */
const MAX_NEWS_ITEMS = 4;

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

interface AiAnalysis {
  sentiment?: string;
  summary?: string;
  /** 帶出處的催化劑；source 為 newsItems 的 1 起算索引，null 表示模型推論 */
  catalysts?: Array<{ text?: string; source?: number | null } | string>;
  stocks?: Array<{
    code: string;
    name: string;
    reason: string;
    reasonSource?: number | null;
    sector: string;
  }>;
}

export interface SourcedClaim {
  text: string;
  source: number | null;
}

/**
 * 把模型填的出處正規化。
 *
 * 只接受「確實指向本次提供的新聞」的索引。模型很可能填出超出範圍的數字或
 * 憑空的索引，照收會讓畫面上出現指向不存在來源的引註 —— 那比沒有引註更糟，
 * 因為它看起來像已經查核過。無法對應者一律當作模型推論（null）。
 */
export function normalizeClaims(
  raw: AiAnalysis["catalysts"],
  newsCount: number,
): SourcedClaim[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return { text: item.trim(), source: null };
      const text = typeof item?.text === "string" ? item.text.trim() : "";
      return { text, source: normalizeSource(item?.source, newsCount) };
    })
    .filter((c) => c.text.length > 0);
}

export function normalizeSource(raw: unknown, newsCount: number): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= newsCount ? raw : null;
}

/** 四到六位純數字，與 isStockCode 及前端 queriedStock 同一套規則 */
const STOCK_CODE_PATTERN = /^\d{4,6}$/;

const REQUIRED_STOCK_FIELDS = ["code", "name", "reason", "sector"] as const;

/**
 * 過濾模型給的標的清單。
 *
 * openapi 宣告 StockInfo 的 code／name／reason／sector 全部 required，但唯一的
 * 約束是 prompt 裡的一句話 —— generationConfig 只設了 responseMimeType，
 * 沒有 responseSchema。少一個 name，前端 `queriedStock` 的 `s.name.trim()`
 * 就是 TypeError；那個 throw 發生在 render 期間的 useMemo 裡，而整個 app
 * 沒有 ErrorBoundary，結果是整棵樹卸載、畫面全白，連返回首頁都沒有。
 * code 為 null 更糟：TanStack Query 會算出 enabled: false 而 isPending 恆真，
 * 分析頁的全螢幕遮罩因此永遠不消失。
 *
 * 而這一切都會被寫進當日快取 —— 同一個關鍵字整天重試都是同一個死結。
 */
export function sanitizeStocks(
  raw: unknown,
  newsCount: number,
): NonNullable<AiAnalysis["stocks"]> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .filter((s) =>
      REQUIRED_STOCK_FIELDS.every(
        (k) => typeof s[k] === "string" && (s[k] as string).trim().length > 0,
      ),
    )
    .filter((s) => STOCK_CODE_PATTERN.test((s["code"] as string).trim()))
    .map((s) => ({
      code: (s["code"] as string).trim(),
      name: (s["name"] as string).trim(),
      reason: (s["reason"] as string).trim(),
      sector: (s["sector"] as string).trim(),
      reasonSource: normalizeSource(s["reasonSource"], newsCount),
    }));
}

/**
 * 依序嘗試的模型。
 *
 * 刻意不用 gemini-2.5-flash —— 較新的 API 金鑰對該模型會回 404
 * （"no longer available to new users"），而 gemini-flash-latest
 * 與 gemini-3.5-flash 兩把金鑰實測皆可用。
 */
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-3.5-flash"] as const;

const GEMINI_KEY_VARS = ["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"] as const;

function geminiKeys(): string[] {
  return GEMINI_KEY_VARS.map((name) => process.env[name]?.trim()).filter(
    (value): value is string => Boolean(value),
  );
}

/**
 * 溫度歸零。
 *
 * 預設溫度（約 1.0）會讓同一個關鍵字每次回傳不同的標的名單 —— 實測同一查詢
 * 三次得到三組名單，核心兩三檔穩定、後段會漂。選股名單不該是隨機的，
 * 因此把採樣隨機性關掉。這不保證完全確定性（模型本身仍有浮動），但漂移大幅收斂。
 */
const GEMINI_TEMPERATURE = 0;

/**
 * 遍歷「模型 × 金鑰」的所有組合，任一成功即回傳。
 *
 * 單純輪替金鑰不夠：不同金鑰能存取的模型不同，換了金鑰仍可能因模型不可用而失敗。
 * 先固定模型換金鑰（額度問題可解），再換下一個模型（可用性問題可解）。
 */
async function generateWithFallback(
  prompt: string,
  log: { warn: (obj: unknown, msg: string) => void },
): Promise<string> {
  const keys = geminiKeys();
  let lastError: unknown = null;

  for (const model of GEMINI_MODELS) {
    for (const [index, key] of keys.entries()) {
      try {
        const genAI = new GoogleGenerativeAI(key);
        const client = genAI.getGenerativeModel({
          model,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: GEMINI_TEMPERATURE,
          } as Parameters<typeof genAI.getGenerativeModel>[0]["generationConfig"],
        });
        const result = await client.generateContent(prompt);
        return result.response.text();
      } catch (err) {
        lastError = err;
        log.warn(
          {
            model,
            keyIndex: index + 1,
            reason: (err instanceof Error ? err.message : String(err)).slice(0, 160),
          },
          "Gemini attempt failed, trying next combination",
        );
      }
    }
  }

  throw lastError ?? new Error("All Gemini key/model combinations failed");
}

router.post("/analyze", async (req, res) => {
  const { keyword, period } = req.body as { keyword: string; period: string };

  if (!keyword || !period) {
    res.status(400).json({ error: "keyword and period are required" });
    return;
  }

  if (geminiKeys().length === 0) {
    res.status(500).json({ error: "尚未設定 GEMINI_API_KEY，請於 .env 填入至少一把金鑰。" });
    return;
  }

  // 只快取成功結果：失敗不入快取，否則一次額度不足會鎖住整天的查詢
  const cacheKey = analysisCacheKey(keyword, period);
  const day = today();
  const cached = await analysisCache.get(cacheKey, day);
  if (cached) {
    req.log.info({ keyword, period }, "Serving analysis from daily cache");
    res.json(cached);
    return;
  }

  // 配額在快取之後才檢查：命中快取不燒任何外部額度，沒有理由計入用量。
  const quota = await consumeDailyQuota(quotaStore, clientIdentity(req.headers, req.ip), day);
  if (!quota.allowed) {
    req.log.warn({ used: quota.used, limit: quota.limit }, "Daily analysis quota exceeded");
    res.status(429).json({
      error: `今日分析次數已達上限（${quota.limit} 次）。這個限制是為了保護共用的 AI 額度，明天會重置。`,
    });
    return;
  }

  try {
    // ── Step 0: resolve a stock code to its real company + industry ─────────
    const trimmedKeyword = keyword.trim();
    const resolved = isStockCode(trimmedKeyword) ? await resolveStock(trimmedKeyword) : null;
    if (isStockCode(trimmedKeyword) && !resolved) {
      req.log.warn({ keyword: trimmedKeyword }, "Stock code did not resolve; treating as keyword");
    }

    // 判斷新聞是否真的在講這個標的所用的比對詞。代號已解析時用官方公司名與代號
    // （精確比對），否則用關鍵字的兩字組合。
    const targetTerms = resolved
      ? [resolved.stock_name, resolved.stock_id]
      : keywordTerms(trimmedKeyword);

    // ── Step 1: Tavily news search ──────────────────────────────────────────
    let newsItems: Array<{
      title: string;
      url: string;
      content: string;
      publishedAt: string | null;
    }> = [];

    const tavilyKey = process.env["TAVILY_API_KEY"];
    if (tavilyKey) {
      try {
        const tavilyRes = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            // A bare code is hopelessly ambiguous to a web search; always search
            // by company name once we have it. 查詢字串為何長這樣，見 stockNewsQuery。
            query: resolved
              ? stockNewsQuery(resolved.stock_name, resolved.stock_id)
              : `${keyword} 台灣 台股 供應鏈 ${new Date().getFullYear()}`,
            search_depth: "basic",
            max_results: 6,
            include_domains: [...NEWS_DOMAINS],
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (tavilyRes.ok) {
          const data = (await tavilyRes.json()) as TavilyResponse;
          const raw = data.results ?? [];

          // 網域白名單：防護網。實測 Tavily 不會越過 include_domains，
          // 但白名單漏設或其行為改變時這一層仍會擋住。
          const onDomain = raw.filter((r) => isAllowedNewsUrl(r.url));
          if (onDomain.length < raw.length) {
            req.log.warn(
              { dropped: raw.length - onDomain.length, kept: onDomain.length },
              "Dropped off-whitelist news results",
            );
          }

          // 白名單內仍有一批「不是報導」的頁面：個股總覽、行情、財務統計、
          // 統一編號、搜尋結果。它們的標題有公司名與代號，會通過下一關的
          // 相關性比對，然後佔掉四個名額之一並在畫面上變成一個沒有內容的連結。
          const allowed = onDomain.filter((r) => isNewsArticleUrl(r.url));
          if (allowed.length < onDomain.length) {
            req.log.warn(
              { dropped: onDomain.length - allowed.length, kept: allowed.length },
              "Dropped non-article pages (quote/profile/search)",
            );
          }

          // 相關性：這才是實際會發生的問題。白名單內找不到相關報導時，
          // Tavily 會回傳白名單內的其他文章，模型無從分辨而據此推論供應鏈。
          //
          // 只比對標題，不比對內文。內文一併比對時，聚合頁與「XX 的搜尋結果」頁
          // 會因為列出大量其他公司而誤命中 —— 實測查 8111 留下「台股創新高，
          // DRAM漲價」與「李俊緯的搜尋結果」，真正談立碁的那篇反而排在最後。
          // 標題是這篇報導在講什麼的直接陳述，內文只是它提過什麼。
          const scored = allowed
            .map((r) => ({ r, matches: countMatches(r.title ?? "", targetTerms) }))
            .filter((x) => x.matches > 0);

          if (scored.length < allowed.length) {
            req.log.warn(
              { dropped: allowed.length - scored.length, kept: scored.length, targetTerms },
              "Dropped news that never mentions the target",
            );
          }

          // 命中越多比對詞的排越前面，同分才看 Tavily 自己的分數 ——
          // 只取 5 篇，讓真正談到主題的先佔位，而不是讓泛泛而談的搶走名額
          // 只留 4 篇，而且從此固定這一份：模型看到的編號與畫面顯示的編號必須一致，
          // 否則模型引註第 5 篇時前端沒有第 5 篇可指，那筆出處只能丟掉。
          const picked = scored
            .sort((a, b) => b.matches - a.matches || (b.r.score ?? 0) - (a.r.score ?? 0))
            .slice(0, MAX_NEWS_ITEMS)
            .map(({ r }) => ({
              title: r.title,
              url: r.url,
              content: r.content?.slice(0, 500) ?? "",
            }));

          // 發布日期只能從文章頁讀 —— Tavily 的一般搜尋不回傳它（見 articleDate）。
          // 實測查正文 4906 時結果裡混著一篇 2023 年的報導，與今年的新聞並列
          // 送進模型，畫面上也沒有一個字說明它是舊聞。日期同時給模型與使用者。
          const dates = await fetchPublishedDates(picked.map((p) => p.url));
          newsItems = picked.map((p, i) => ({
            ...p,
            publishedAt: dates[i]?.publishedAt ?? null,
          }));

          const undated = newsItems.filter((n) => n.publishedAt === null).length;
          if (undated > 0) {
            req.log.info({ undated, total: newsItems.length }, "Some articles have no published date");
          }
        }
      } catch (searchErr) {
        req.log.warn({ searchErr }, "Tavily search failed, continuing without news");
      }
    }

    // ── Step 2: Gemini analysis ─────────────────────────────────────────────
    const periodLabel =
      period === "1m" ? "1個月" : period === "3m" ? "3個月" : "6個月";

    // 走到這裡的新聞都已通過來源與相關性檢查，不需要再標註可信度
    // 發布日期寫進 prompt：搜尋結果會混入數年前的報導（實測查正文撈到 2023 年的
    // 工商時報文章），沒有日期時模型無從分辨那是不是「近期發展」。
    const newsText =
      newsItems.length > 0
        ? newsItems
            .map(
              (n, i) =>
                `[${i + 1}]${n.publishedAt ? `（發布於 ${n.publishedAt}）` : "（發布日期不明）"} ${n.title}\n${n.content}`,
            )
            .join("\n\n")
        : "（未找到近期相關新聞，請依據產業知識與最新市況分析，並在 summary 說明近期無相關報導）";

    // When the code resolved, state the ground truth and forbid re-interpretation —
    // this is what stops irrelevant search hits from redefining the industry.
    const targetBlock = resolved
      ? `【分析標的 — 已由證交所／櫃買中心資料確認，不得改判】
代號：${resolved.stock_id}
公司：${resolved.stock_name}
產業類別：${resolved.industry_category}

必須遵守：
1. stocks 陣列的「第一筆」必須是 ${resolved.stock_id} ${resolved.stock_name}。
2. 其餘 2~4 家必須與其同屬「${resolved.industry_category}」或位於同一條供應鏈。
3. summary 必須聚焦 ${resolved.stock_name} 所處的具體次產業，不得改寫成其他產業。
4. 若下方新聞與 ${resolved.stock_name} 無關，一律忽略，改用你對該公司的既有知識，切勿依據無關新聞推論產業。`
      : `產業關鍵字：${keyword}

必須遵守：
1. 分析對象是「${keyword}」本身，不得改寫成其他產業。
2. 若下方顯示未找到相關新聞，請改用你對「${keyword}」的既有產業知識作答，並在 summary 說明近期無相關報導。`;

    const prompt = `你是專業台股產業分析師，請分析以下產業並輸出嚴格的 JSON 格式，不可添加任何額外文字或 markdown。

${targetBlock}
分析週期：${periodLabel}

近期相關新聞：
${newsText}

輸出格式（必須完整且合法的 JSON）：
{
  "sentiment": "bullish" | "neutral" | "bearish",
  "summary": "（2-3句話的產業現況總結，繁體中文）",
  "catalysts": [
    { "text": "催化劑1（繁體中文，一句話）", "source": 1 },
    { "text": "催化劑2（繁體中文，一句話）", "source": null },
    { "text": "催化劑3（繁體中文，一句話）", "source": 3 }
  ],
  "stocks": [
    {
      "code": "XXXX（4位數字，真實台灣上市/上櫃代號）",
      "name": "公司名稱（繁體中文）",
      "reason": "選入原因（1句話，繁體中文）",
      "reasonSource": 2,
      "sector": "所屬次產業（繁體中文）"
    }
  ]
}

出處標註規則（極重要）：
- source 與 reasonSource 只能填上方新聞的編號（1~${newsItems.length || 0}），且該篇新聞必須真的寫到這件事。
- 若這句話是你依既有知識推論、上方新聞並未提及，**必須填 null**。填一個對不上的編號比填 null 嚴重得多。
- 寧可多填 null。使用者會看到「模型推論」標記，那是誠實的；填錯編號會讓推論看起來像已查核的事實。
- 每篇新聞都標了發布日期。距今超過半年的報導不得當作「近期發展」陳述；若催化劑只有舊聞支持，改填 null 並在 summary 說明依據的是較早的報導。

嚴格要求：
- stocks 必須選 3~5 家，為台灣上市/上櫃公司，聚焦 ${resolved ? `${resolved.stock_name}（${resolved.industry_category}）所處的` : `${keyword} 產業`}核心供應鏈龍頭
- 股票代號必須是真實存在的台灣上市/上櫃代號（如：3324、3017、2317）
- catalysts 至少 3 個
- 所有文字使用繁體中文
- sentiment: bullish=看多、neutral=中性觀望、bearish=看空`;

    const raw = await generateWithFallback(prompt, req.log);
    const aiData = JSON.parse(raw) as AiAnalysis;

    // 回傳給前端的新聞只取前 4 篇，出處索引必須以「前端看得到的那幾篇」為界，
    // 否則畫面上會出現指向不存在項目的引註。
    const shownNews = newsItems.map((n) => ({
      title: n.title,
      url: n.url,
      source: newsSourceName(n.url),
      publishedAt: n.publishedAt,
    }));
    const catalystDetails = normalizeClaims(aiData.catalysts, shownNews.length);

    const payload: AnalyzePayload = {
      keyword,
      period,
      sentiment: aiData.sentiment ?? "neutral",
      summary: aiData.summary ?? "",
      // 純文字版與帶出處版由同一份輸出產生，順序一致，不會不同步
      catalysts: catalystDetails.map((c) => c.text),
      catalystDetails,
      // 模型輸出唯一的約束是 prompt 裡的一句話 —— 缺欄位、假代號、
      // 甚至 null 元素都進得來，而畫面對它們沒有任何防禦。
      stocks: sanitizeStocks(aiData.stocks, shownNews.length),
      newsItems: shownNews,
    };

    // 一檔都認不出來時不入快取。壞結果被鎖成當日答案的後果比失敗嚴重得多：
    // 快取鍵是 keyword+period+day，之後整整一天所有人查同一個關鍵字都拿到
    // 同一份壞資料，重新整理與換裝置都沒用。與 stock.ts 的
    // 「只快取成功結果」同一個原則。
    if (payload.stocks.length === 0) {
      req.log.warn({ keyword, period }, "Model returned no usable stocks; not caching");
      res.status(502).json({
        error: "AI 回傳的標的清單無法辨識（可能是暫時性的模型輸出異常），請再試一次。",
      });
      return;
    }

    await analysisCache.set(cacheKey, day, payload);
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Industry analysis failed");

    // Report the actual cause. A blanket "check your API key" sent the user
    // hunting for a config problem when the real limit was a spent daily quota.
    res.status(500).json({
      error: describeGeminiFailure(err, {
        keyCount: geminiKeys().length,
        modelCount: GEMINI_MODELS.length,
      }),
    });
  }
});

export default router;
