import { Router } from "express";
import { deriveAdvice } from "@workspace/advice";

import {
  calcATR,
  calcAvgVolume,
  calcMA,
  calcSwing,
  calcTrailingStop,
  type PriceRow,
} from "../lib/indicators";
import { PERIOD_TRADING_DAYS, calcEV, horizonFactor } from "../lib/tradePlan";
import { resolveStock } from "../lib/stockInfo";
import { roundToTick } from "../lib/ticks";
import { buildUrl, dateMinusDays, dateMinusMonths, fetchFinMind } from "../lib/finmind";
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
const RULE_VERSION = 2;

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

interface InstitutionalRow {
  date: string;
  name: string;
  buy: number;
  sell: number;
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
      fetchFinMind<PriceRow>(buildUrl("TaiwanStockPrice", code, dateMinusDays(150), token)),
      fetchFinMind<RevenueRow>(buildUrl("TaiwanStockMonthRevenue", code, dateMinusMonths(15), token)),
      fetchFinMind<InstitutionalRow>(buildUrl("TaiwanStockInstitutionalInvestorsBuySell", code, dateMinusDays(35), token)),
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

    // ── Institutional 30d aggregate ────────────────────────────────────────
    let foreignNet = 0;
    let trustNet = 0;
    let dealerNet = 0;

    for (const d of institutionals) {
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

    // ── Phase 4: EV engine ─────────────────────────────────────────────────
    const ev = calcEV({
      revenueYoY,
      maSignal,
      currentPrice,
      ma20,
      ma60,
      atr,
      foreignNet30dShares: foreignNet,
      trustNet30dShares: trustNet,
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
      priceAsOf,
      chipsAsOf,
      revenueAsOf: revenueHistory[0]?.yearMonth ?? null,
      ruleVersion: RULE_VERSION,
      advice,
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
