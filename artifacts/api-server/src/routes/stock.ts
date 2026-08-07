import { Router } from "express";
import { deriveAdvice, deriveInvalidation } from "@workspace/advice";

import {
  buildPriceSeries,
  calcATR,
  calcAvgVolume,
  calcKD,
  calcMA,
  calcMACD,
  calcSwing,
  calcTrailingStop,
  calcVolumeProfile,
  type PriceRow,
} from "../lib/indicators";
import { detectSignals, detectTrend } from "../lib/signals";
import { PERIOD_TRADING_DAYS, buildStopBasis, calcEV, horizonFactor } from "../lib/tradePlan";
import { buildNarrative } from "../lib/narrative";
import { resolveStock } from "../lib/stockInfo";
import { roundToTick } from "../lib/ticks";
import {
  buildUrl,
  dateMinusDays,
  dateMinusMonths,
  fetchFinMind,
  fetchFinMindResult,
  toDateStr,
} from "../lib/finmind";
import { buildChips, type InstitutionalRow } from "../lib/chips";
import { dailyCacheFor } from "../lib/caches";
import { marketCacheKey, stockCacheKey, today } from "../lib/dailyCache";
import {
  buildMarketContext,
  buildRelativeStrength,
  buildReturns,
  type MarketContext,
} from "../lib/market";
import type { DividendResultRow } from "../lib/dividend";

const router = Router();

/**
 * 個股資料同樣以日為單位快取。
 *
 * 這裡的效益比分析那份還大：一次分析會顯示 3~5 檔，每檔要打 4 個 FinMind
 * 請求（股價、月營收、法人、基本資料），所以單一頁面就是 12~20 次外部呼叫。
 * 而日線資料本來就延遲一天，同一天內重複抓只會得到同一份數字。
 */
const stockCache = dailyCacheFor<Record<string, unknown>>();

/** 大盤脈絡的日快取。與個股分開，讓一次分析只多 1 個 FinMind 請求 */
const marketCache = dailyCacheFor<MarketContext>();

/**
 * 計算規則版本。任何會改變畫面上顯示數字的變更都必須遞增，
 * 並同步更新 `stockCacheKey` 的版本前綴 —— 前瞻驗證靠這個值分辨
 * 每筆快照是哪一套規則算出來的。
 */
const RULE_VERSION = 4;

/**
 * 法人資料的抓取範圍（日曆日）。
 *
 * 要算 20 個交易日的視窗至少需要 20 個開市日；30 個日曆日理論上剛好，
 * 但農曆年連假一次就能吃掉 9 天以上，屆時 20 日窗會整個變成 null。
 * 60 個日曆日 ≈ 40 個交易日，留足緩衝，而且成本不變 —— 同一次請求、
 * 同一個資料集，只是起始日往前挪。
 */
const CHIPS_FETCH_DAYS = 60;

/**
 * 股價的抓取範圍（日曆日）。
 *
 * 原本是 150 日曆日（≈102 根）。MACD 的 EMA 是遞迴的，種子的影響會隨
 * 資料變長而衰減卻永遠不會歸零，EMA26 需要約 78 根之後才算穩定 ——
 * 102 根算得出來但不寬裕，而且 MA60 也只多 42 根。
 * 240 個日曆日 ≈ 163 根，兩者都留足餘裕，且仍是同一次請求。
 */
const PRICE_FETCH_DAYS = 240;

/**
 * 舊的「30日」累積所涵蓋的範圍（日曆日），刻意與抓取範圍分開。
 *
 * 這個數字不是顯示用的，而是餵給 calcEV 的評分輸入。抓取範圍從 35 拉到 60
 * 之後，若仍照「把抓回來的資料整段加總」的寫法，這個值會無聲地從
 * 約 24 個交易日變成約 40 個 —— 評分跟著漂移，卻沒有任何版本號能區分
 * 前後兩批快照。因此把它釘在原本的視窗上，改評分基準是另一件事，
 * 要做就要連同 RULE_VERSION 一起遞增。
 *
 * （順帶一提，35 個日曆日約等於 24 個交易日，欄位名稱裡的「30日」
 * 從一開始就不是 30 個交易日。）
 */
const LEGACY_CHIPS_DAYS = 35;

/** 只接受規格中的三個值，其餘（含未帶參數）一律當基準週期 */
function normalizePeriod(raw: unknown): string {
  return typeof raw === "string" && raw in PERIOD_TRADING_DAYS ? raw : "3m";
}

// ─── FinMind response types ────────────────────────────────────────────────
interface RevenueRow {
  date: string;
  revenue: number;
  revenue_month: number;
  revenue_year: number;
}

/**
 * 取得當日大盤脈絡。
 *
 * 抓不到時回 null 而非丟例外 —— 與 fetchFinMind 的失敗策略一致：
 * 少了大盤脈絡，個股自己的交易計畫仍然完全有效，整個請求失敗反而讓
 * 使用者什麼都看不到。
 */
async function getMarketContext(
  day: string,
  token: string | undefined,
): Promise<MarketContext | null> {
  const cached = await marketCache.get(marketCacheKey(), day);
  if (cached) return cached;

  const rows = await fetchFinMind<PriceRow>(
    buildUrl("TaiwanStockPrice", "TAIEX", dateMinusDays(PRICE_FETCH_DAYS), token),
  );
  if (rows.length === 0) return null;

  const context = buildMarketContext(rows);
  await marketCache.set(marketCacheKey(), day, context);
  return context;
}

// ─── GET /api/stock/:code ──────────────────────────────────────────────────
router.get("/stock/:code", async (req, res) => {
  const { code } = req.params;
  const token = process.env["FINMIND_TOKEN"]; // optional
  const period = normalizePeriod(req.query["period"]);

  const cacheKey = stockCacheKey(code, period);
  const day = today();
  const cached = await stockCache.get(cacheKey, day);
  if (cached) {
    req.log.info({ code, period }, "Serving stock detail from daily cache");
    res.json(cached);
    return;
  }

  try {
    // Fetch price, revenue (15mo for YoY), institutional (30d), plus the official
    // name/industry so the client can cross-check the model's free-text labels
    // against the exchange's own classification.
    //
    // 除息紀錄的抓取範圍（日曆日）。ATR 只需要近期的除息日，但五年份是同一次
    // 請求的成本，多抓不虧，且未來要放寬 ATR 週期時不必再改。
    const DIVIDEND_FETCH_DAYS = 1830;

    const [
      priceResult,
      revenueResult,
      institutionalResult,
      info,
      market,
      dividendResults,
    ] = await Promise.all([
      // 這三個資料集直接決定評分。它們用 fetchFinMindResult 是因為
      // 「抓不到」與「值是零」對評分的意義完全不同，而先前兩者都是空陣列。
      fetchFinMindResult<PriceRow>(buildUrl("TaiwanStockPrice", code, dateMinusDays(PRICE_FETCH_DAYS), token)),
      fetchFinMindResult<RevenueRow>(buildUrl("TaiwanStockMonthRevenue", code, dateMinusMonths(15), token)),
      fetchFinMindResult<InstitutionalRow>(
        buildUrl("TaiwanStockInstitutionalInvestorsBuySell", code, dateMinusDays(CHIPS_FETCH_DAYS), token),
      ),
      // 公司基本資料以日快取，同一檔當天之後完全不發請求
      resolveStock(code),
      // 與個股平行抓，不佔用額外的往返時間；命中日快取時完全不發請求
      getMarketContext(day, token),
      // 除息日：ATR 要用它把配息造成的跳空排除掉，那是每一種視圖都受影響的計算。
      // PER 與 Dividend 已移到 /stock/:code/fundamentals —— 它們只餵
      // value／dividend 兩個視圖，而預設視圖是 newbie。
      fetchFinMind<DividendResultRow>(
        buildUrl("TaiwanStockDividendResult", code, dateMinusDays(DIVIDEND_FETCH_DAYS), token),
      ),
    ]);

    // 哪些影響評分的資料集這次沒抓到。空陣列代表評分是完整的。
    //
    // 估值與股利不列入：它們只餵價值／存股視圖的展示區塊，不進評分公式，
    // 缺了畫面本來就有「—」可以表示。營收與籌碼則不同 —— 少算的是
    // ±3 與 ±2.5 分，evScore 會從 5.5 掉到 0，而畫面上的 E(V) 仍是一個
    // 看起來完全正常的精確數字。
    const degraded: string[] = [];
    if (!priceResult.ok) degraded.push("price");
    if (!revenueResult.ok) degraded.push("revenue");
    if (!institutionalResult.ok) degraded.push("institutional");
    if (degraded.length > 0) {
      req.log.warn(
        { code, degraded, reasons: [priceResult, revenueResult, institutionalResult].filter((r) => !r.ok) },
        "Scoring inputs incomplete; result will not be cached",
      );
    }

    const prices = priceResult.ok ? priceResult.rows : [];
    const revenues = revenueResult.ok ? revenueResult.rows : [];
    const institutionals = institutionalResult.ok ? institutionalResult.rows : [];

    // ── Price / MA ─────────────────────────────────────────────────────────
    const closes = prices.map((p) => p.close).filter(Boolean);
    const currentPrice = closes[closes.length - 1] ?? null;
    const ma20 = calcMA(closes, 20);
    const ma60 = calcMA(closes, 60);
    // 除息日的跳空不是波動，是股利離開股價。這份資料本來就抓回來了
    // （buildDividend 在用），只是從來沒有餵給指標。台股除息季是 7~9 月，
    // 少了這一步，高殖利率股在除息後兩週的停損距離會憑空拉寬約 18%。
    const exDates = new Set(
      dividendResults.map((d) => d.date).filter((d): d is string => typeof d === "string"),
    );
    const atr = calcATR(prices, 14, exDates);
    const priceAsOf = prices[prices.length - 1]?.date ?? null;
    const swing = calcSwing(prices);
    const avgVolume20 = calcAvgVolume(prices);
    const macd = calcMACD(closes);
    const kd = calcKD(prices);
    const volume = calcVolumeProfile(prices);
    // 價位地圖的走勢線。prices 本來就抓了 240 個日曆日（≈163 根），
    // 切最後 N 根即可 —— 零額外請求。N 跟著分析週期，
    // 「這張圖的尺度與你選的持有期一致」本身就可以解釋，
    // 不必再給卡片加一組控制元件。
    const priceSeries = buildPriceSeries(prices, PERIOD_TRADING_DAYS[period] ?? 60);

    let maSignal: "above_both" | "above_ma20" | "below_both" | "insufficient_data" =
      "insufficient_data";
    if (currentPrice !== null && ma20 !== null && ma60 !== null) {
      if (currentPrice >= ma20 && currentPrice >= ma60) maSignal = "above_both";
      else if (currentPrice >= ma20) maSignal = "above_ma20";
      else maSignal = "below_both";
    }

    // ── Revenue YoY ────────────────────────────────────────────────────────
    // Build a map: "YYYY-M" → revenue
    const revMap: Record<string, number> = {};
    for (const r of revenues) {
      revMap[`${r.revenue_year}-${r.revenue_month}`] = r.revenue;
    }

    // Find the most recent revenue entry
    const sortedRevs = [...revenues].sort((a, b) =>
      a.revenue_year !== b.revenue_year
        ? b.revenue_year - a.revenue_year
        : b.revenue_month - a.revenue_month,
    );

    let revenueYoY: number | null = null;
    let revenueHistory: Array<{ yearMonth: string; revenue: number; yoy: number | null }> = [];

    if (sortedRevs.length > 0) {
      // Build history for latest 6 entries with YoY
      const recent = sortedRevs.slice(0, 6);
      revenueHistory = recent.map((r) => {
        const lastYearKey = `${r.revenue_year - 1}-${r.revenue_month}`;
        const lastYearRev = revMap[lastYearKey];
        const yoy =
          lastYearRev && lastYearRev > 0
            ? ((r.revenue - lastYearRev) / lastYearRev) * 100
            : null;
        return {
          yearMonth: `${r.revenue_year}/${String(r.revenue_month).padStart(2, "0")}`,
          revenue: r.revenue,
          yoy,
        };
      });

      revenueYoY = revenueHistory[0]?.yoy ?? null;
    }

    // ── Institutional 30d aggregate（評分輸入，視窗釘死） ──────────────────
    // 只加總落在 LEGACY_CHIPS_DAYS 之內的記錄。抓取範圍已擴大到 60 日，
    // 少了這道過濾，餵給 calcEV 的數字會跟著變大。
    const legacyStart = toDateStr(dateMinusDays(LEGACY_CHIPS_DAYS));
    let foreignNet = 0;
    let trustNet = 0;
    let dealerNet = 0;

    for (const d of institutionals) {
      if (typeof d.date !== "string" || d.date < legacyStart) continue;
      const net = (d.buy ?? 0) - (d.sell ?? 0); // units: shares (股)
      const n = d.name ?? "";
      if (n === "Foreign_Investor" || n === "Foreign_Dealer_Self") {
        foreignNet += net;
      } else if (n === "Investment_Trust") {
        trustNet += net;
      } else if (n === "Dealer_self" || n === "Dealer_Hedging") {
        dealerNet += net;
      }
    }

    const institutionalNet30d = foreignNet + trustNet + dealerNet;

    // ── 多天期籌碼（顯示用） ───────────────────────────────────────────────
    // 以交易日切窗，與上面那組釘死的累積各走各的，互不影響。
    const chips = buildChips(institutionals, avgVolume20);

    // ── Phase 4: EV engine ─────────────────────────────────────────────────
    // 籌碼改以 20 個交易日為基準（規則版本 3）。舊的 `foreignNet`／`trustNet`
    // 仍在 payload 中供舊快照對照，但不再參與評分。
    const ev = calcEV({
      revenueYoY,
      maSignal,
      currentPrice,
      ma20,
      ma60,
      atr,
      foreignNet20dShares: chips.foreign.windows.d20,
      trustNet20dShares: chips.trust.windows.d20,
      foreignTrend: chips.foreign.trend,
      period,
    });

    // Chandelier exit，掛在部位高點之下並隨新高上移。規劃階段的部位高點就是進場價 ——
    // 用近 20 日高會算出高於進場價的停損（見 calcTrailingStop 註解），
    // 因此必須在 calcEV 算出進場區間之後才能計算。
    const entryMid =
      ev.entryLow !== null && ev.entryHigh !== null ? (ev.entryLow + ev.entryHigh) / 2 : null;
    const rawTrailing = calcTrailingStop(entryMid, atr, horizonFactor(period));
    const trailingStop = rawTrailing === null ? null : roundToTick(rawTrailing);

    // 由價位幾何推出「現在能不能買」。必須在 calcEV 之後 ——
    // 它讀的是算完並取整後的進場區與停損。
    const advice = deriveAdvice({
      currentPrice,
      entryLow: ev.entryLow,
      entryHigh: ev.entryHigh,
      stopLoss: ev.stopLoss,
    });

    // ── 訊號依據與趨勢（只做顯示，不進評分） ───────────────────────────────
    // 命名刻意不是「AI 推薦原因」：這些全由程式規則算出，而 Gemini 的呼叫
    // 發生在抓取個股資料之前，模型從未看過任何價格數字。
    const signals = detectSignals({
      closes,
      rows: prices,
      ma20,
      ma60,
      macd,
      kd,
      volume,
      chips,
      revenueYoY,
    });
    const trend = detectTrend(closes, ma20, ma60);

    // ── 停損依據與失效條件（第三階段） ─────────────────────────────────────
    const swingLow = swing.low !== null ? Math.round(swing.low * 100) / 100 : null;
    const stopBasis = buildStopBasis(atr, horizonFactor(period), {
      swingLow,
      ma20: ma20 !== null ? Math.round(ma20 * 100) / 100 : null,
    });

    // 尚未成立的計畫看的是結構（近 20 日低）而非停損 ——
    // 停損是由「假設中的進場價」推出來的，那個進場價還沒發生。
    const invalidation = deriveInvalidation({
      planKind: advice.planKind,
      stopLoss: ev.stopLoss,
      swingLow,
      period,
    });

    const narrative = buildNarrative({
      name: info?.stock_name ?? null,
      code,
      trend: trend.trend,
      action: advice.action,
      planKind: advice.planKind,
      signals,
      foreignNet5d: chips.foreign.windows.d5,
      foreignTrend: chips.foreign.trend,
      entryLow: ev.entryLow,
      entryHigh: ev.entryHigh,
      stopLoss: ev.stopLoss,
      riskRewardRatio: ev.riskRewardRatio,
      period,
    });

    // 三個來源各自標日期。FinMind 的法人資料與股價未必同步更新，
    // 合成一個「更新時間」會把這個差異蓋掉。
    const chipsAsOf = institutionals.reduce<string | null>(
      (latest, row) => (latest === null || row.date > latest ? row.date : latest),
      null,
    );

    const payload = {
      code,
      period,
      currentPrice,
      ma20: ma20 !== null ? Math.round(ma20 * 100) / 100 : null,
      ma60: ma60 !== null ? Math.round(ma60 * 100) / 100 : null,
      maSignal,
      revenueYoY: revenueYoY !== null ? Math.round(revenueYoY * 10) / 10 : null,
      revenueHistory,
      institutionalNet30d,
      foreignNet30d: foreignNet,
      trustNet30d: trustNet,
      dealerNet30d: dealerNet,
      chips,
      signals,
      trend: trend.trend,
      trendBasis: trend.basis,
      macd: macd === null ? null : {
        dif: Math.round(macd.dif * 100) / 100,
        dea: Math.round(macd.dea * 100) / 100,
        osc: Math.round(macd.osc * 100) / 100,
        cross: macd.cross,
      },
      kd: kd === null ? null : {
        k: Math.round(kd.k * 10) / 10,
        d: Math.round(kd.d * 10) / 10,
        cross: kd.cross,
      },
      volume: volume === null ? null : {
        latest: volume.latest,
        avg5: volume.avg5,
        avg20: Math.round(volume.avg20),
        ratio: Math.round(volume.ratio * 100) / 100,
        kind: volume.kind,
      },
      priceAsOf,
      chipsAsOf,
      revenueAsOf: revenueHistory[0]?.yearMonth ?? null,
      ruleVersion: RULE_VERSION,
      advice,
      invalidation,
      stopBasis,
      narrative,
      stockName: info?.stock_name ?? null,
      officialIndustry: info?.industry_category ?? null,
      atr: atr !== null ? Math.round(atr * 100) / 100 : null,
      trailingStop,
      swingHigh: swing.high !== null ? Math.round(swing.high * 100) / 100 : null,
      swingLow: swing.low !== null ? Math.round(swing.low * 100) / 100 : null,
      avgVolume20: avgVolume20 !== null ? Math.round(avgVolume20) : null,
      priceSeries,
      // 個股自身的多天期報酬。相對強弱要用，畫面也直接顯示 —— 少了絕對報酬，
      // 使用者看到「相對大盤 +3%」無從判斷是兩者都漲還是兩者都跌。
      returns: buildReturns(closes),
      // 相對大盤。null 代表當日抓不到加權指數，畫面整塊不渲染。
      relativeStrength: market ? buildRelativeStrength(buildReturns(closes), market) : null,
      market,
      // 估值只放統計結果，不放 1,461 筆原始序列 —— 那會讓五檔的回應
      // 多出約 675 KB，而它還要進 localStorage 快照。
      // valuation 與 dividend 已移到 /stock/:code/fundamentals。
      // 契約上仍保留這兩個欄位，但只為了讀得懂 localStorage 裡的舊快照。
      // Net flow expressed in days of average volume — "+91 lots" means nothing
      // without knowing whether the stock trades 100 or 100,000 lots a day.
      foreignNetDays:
        avgVolume20 && avgVolume20 > 0 ? Math.round((foreignNet / avgVolume20) * 100) / 100 : null,
      trustNetDays:
        avgVolume20 && avgVolume20 > 0 ? Math.round((trustNet / avgVolume20) * 100) / 100 : null,
      ...ev,
      degraded,
    };

    // 只快取成功結果。FinMind 失敗時算出來會是一份被稀釋過的評分 ——
    // 那份不該被鎖成當天的答案。先前只擋了「連收盤價都沒有」這一種，
    // 而額度用盡最常見的樣子是價格有、營收與籌碼沒有：evScore 掉了 5.5 分，
    // currentPrice 卻不是 null，於是那份結果被寫進快取供應一整天，
    // 使用者重新整理、換裝置、明天早上八點前來查，拿到的都是同一份。
    if (currentPrice !== null && degraded.length === 0) {
      await stockCache.set(cacheKey, day, payload);
    }

    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Stock data fetch failed");
    res.status(500).json({ error: "Failed to fetch stock data" });
  }
});

export default router;
