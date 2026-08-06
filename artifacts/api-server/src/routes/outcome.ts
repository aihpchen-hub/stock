import { Router } from "express";

import { buildUrl, fetchFinMind } from "../lib/finmind";
import {
  evaluateOutcome,
  tallyOutcomes,
  type Bar,
  type ExDividend,
  type OutcomeKind,
} from "../lib/outcome";
import type { DividendResultRow } from "../lib/dividend";

const router = Router();

/**
 * 一次驗證多筆計畫。
 *
 * 為什麼是 POST 而不是 GET：每一筆要帶代號、起算日與三個價位，一次可能十幾筆，
 * 塞在 query string 會超長且難讀。這個端點不改變任何狀態，POST 只是為了帶得下請求主體。
 */
interface VerifyRequestItem {
  code: string;
  /** 當初做出這份計畫的日期（YYYY-MM-DD） */
  from: string;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
}

interface VerifyResponseItem {
  code: string;
  from: string;
  kind: OutcomeKind;
  entryDate: string | null;
  exitDate: string | null;
  barsHeld: number;
  maxFavorablePct: number | null;
  maxAdversePct: number | null;
}

/** 一次最多驗證的筆數，避免單一請求打出上百個 FinMind 查詢 */
const MAX_ITEMS = 40;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidItem(raw: unknown): raw is VerifyRequestItem {
  if (typeof raw !== "object" || raw === null) return false;
  const it = raw as Record<string, unknown>;
  return (
    typeof it["code"] === "string" &&
    it["code"].length > 0 &&
    typeof it["from"] === "string" &&
    DATE_RE.test(it["from"]) &&
    typeof it["entryLow"] === "number" &&
    typeof it["entryHigh"] === "number" &&
    typeof it["stopLoss"] === "number" &&
    typeof it["takeProfit"] === "number"
  );
}

const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

// ─── POST /api/outcomes ────────────────────────────────────────────────────
router.post("/outcomes", async (req, res) => {
  const body = req.body as { items?: unknown };
  const raw = Array.isArray(body?.items) ? body.items : null;

  if (!raw) {
    res.status(400).json({ error: "items 必須是陣列" });
    return;
  }

  const items = raw.filter(isValidItem).slice(0, MAX_ITEMS);
  if (items.length < raw.length) {
    req.log.warn(
      { received: raw.length, accepted: items.length },
      "Dropped invalid or excess outcome items",
    );
  }

  const token = process.env["FINMIND_TOKEN"];

  try {
    // 同一檔股票可能出現在多筆不同日期的計畫裡，先按「代號＋起算日」去重，
    // 避免同一份行情抓好幾次。
    const uniqueFetches = new Map<string, Promise<Bar[]>>();
    const fetchBars = (code: string, from: string) => {
      const key = `${code}|${from}`;
      let p = uniqueFetches.get(key);
      if (!p) {
        p = fetchFinMind<Bar>(buildUrl("TaiwanStockPrice", code, from, token));
        uniqueFetches.set(key, p);
      }
      return p;
    };

    /**
     * 除息造成的價格斷層。抓的是原始股價，除息當天整條序列會往下跳一個
     * 股利的幅度 —— 持有的人拿到的是現金而不是虧損，但 bar.min 確實跌破了
     * 停損價，於是一筆配息會被判成 "stop"。台股除息季是 7~9 月，而達標率
     * 是校正那張未經回測機率表的唯一手段。
     *
     * 每個代號多一個請求，但同樣依代號去重，而這支端點使用者一天最多按幾次。
     */
    const uniqueDividends = new Map<string, Promise<ExDividend[]>>();
    const fetchDividends = (code: string, from: string) => {
      const key = `${code}|${from}`;
      let p = uniqueDividends.get(key);
      if (!p) {
        p = fetchFinMind<DividendResultRow>(
          buildUrl("TaiwanStockDividendResult", code, from, token),
        ).then((rows) =>
          rows
            .filter(
              (r): r is DividendResultRow & { before_price: number; after_price: number } =>
                typeof r.date === "string" &&
                typeof r.before_price === "number" &&
                typeof r.after_price === "number",
            )
            .map((r) => ({ date: r.date, drop: r.before_price - r.after_price }))
            .filter((d) => d.drop > 0),
        );
        uniqueDividends.set(key, p);
      }
      return p;
    };

    const results: VerifyResponseItem[] = await Promise.all(
      items.map(async (it) => {
        const [bars, dividends] = await Promise.all([
          fetchBars(it.code, it.from),
          fetchDividends(it.code, it.from),
        ]);
        const r = evaluateOutcome(
          bars,
          {
            entryLow: it.entryLow,
            entryHigh: it.entryHigh,
            stopLoss: it.stopLoss,
            takeProfit: it.takeProfit,
          },
          dividends,
        );
        return {
          code: it.code,
          from: it.from,
          kind: r.kind,
          entryDate: r.entryDate,
          exitDate: r.exitDate,
          barsHeld: r.barsHeld,
          maxFavorablePct: round2(r.maxFavorablePct),
          maxAdversePct: round2(r.maxAdversePct),
        };
      }),
    );

    res.json({ results, tally: tallyOutcomes(results) });
  } catch (err) {
    req.log.error({ err }, "Outcome verification failed");
    res.status(500).json({ error: "驗證失敗，請稍後再試。" });
  }
});

export default router;
