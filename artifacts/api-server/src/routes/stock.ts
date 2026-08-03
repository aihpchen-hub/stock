import { Router } from "express";
import { deriveAdvice, deriveInvalidation } from "@workspace/advice";

import {
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
import { buildUrl, dateMinusDays, dateMinusMonths, fetchFinMind, toDateStr } from "../lib/finmind";
import { buildChips, type InstitutionalRow } from "../lib/chips";
import { dailyCacheFor } from "../lib/caches";
import { stockCacheKey, today } from "../lib/dailyCache";

const router = Router();

/**
 * 個股資料同樣以日為單位快取。
 *
 * 這裡的效益比分析那份還大：一次分析會顯示 3~5 檔，每檔要打 4 個 FinMind
 * 請求（股價、月營收、法人、基本資料），所以單一頁面就是 12~20 次外部呼叫。
 * 而日線資料本來就延遲一天，同一天內重複抓只會得到同一份數字。
 */
const stockCache = dailyCacheFor<Record<string, unknown>>();

/**
 * 計算規則版本。任何會改變畫面上顯示數字的變更都必須遞增，
 * 並同步更新 `stockCacheKey` 的版本前綴 —— 前瞻驗證靠這個值分辨
 * 每筆快照是哪一套規則算出來的。
 */
const RULE_VERSION = 3;

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
    // 150 個日曆日 ≈ 102 個交易日。原本的 100 日只有約 68 個交易日，MA60 僅多 8 根，
    // 遇到連假或暫停交易就可能算不出來。
    const [prices, revenues, institutionals, info] = await Promise.all([
      fetchFinMind<PriceRow>(buildUrl("TaiwanStockPrice", code, dateMinusDays(PRICE_FETCH_DAYS), token)),
      fetchFinMind<RevenueRow>(buildUrl("TaiwanStockMonthRevenue", code, dateMinusMonths(15), token)),
      fetchFinMind<InstitutionalRow>(
        buildUrl("TaiwanStockInstitutionalInvestorsBuySell", code, dateMinusDays(CHIPS_FETCH_DAYS), token),
      ),
      resolveStock(code),
    ]);

    // ── Price / MA ─────────────────────────────────────────────────────────
    const closes = prices.map((p) => p.close).filter(Boolean);
    const currentPrice = closes[closes.length - 1] ?? null;
    const ma20 = calcMA(closes, 20);
    const ma60 = calcMA(closes, 60);
    const atr = calcATR(prices);
    const priceAsOf = prices[prices.length - 1]?.date ?? null;
    const swing = calcSwing(prices);
    const avgVolume20 = calcAvgVolume(prices);
    const macd = calcMACD(closes);
    const kd = calcKD(prices);
    const volume = calcVolumeProfile(prices);

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
      // Net flow expressed in days of average volume — "+91 lots" means nothing
      // without knowing whether the stock trades 100 or 100,000 lots a day.
      foreignNetDays:
        avgVolume20 && avgVolume20 > 0 ? Math.round((foreignNet / avgVolume20) * 100) / 100 : null,
      trustNetDays:
        avgVolume20 && avgVolume20 > 0 ? Math.round((trustNet / avgVolume20) * 100) / 100 : null,
      ...ev,
    };

    // 只快取成功結果。FinMind 失敗時 fetchFinMind 回空陣列，算出來會是一份
    // 「資料不足」的計畫 —— 那份不該被鎖成當天的答案。
    if (currentPrice !== null) {
      await stockCache.set(cacheKey, day, payload);
    }

    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Stock data fetch failed");
    res.status(500).json({ error: "Failed to fetch stock data" });
  }
});

export default router;
