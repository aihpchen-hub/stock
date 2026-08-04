import { Router } from "express";

import { dailyCacheFor } from "../lib/caches";
import { fundamentalsCacheKey, today } from "../lib/dailyCache";
import { buildUrl, dateMinusMonths, fetchFinMind } from "../lib/finmind";
import { buildFinancials, type Financials, type StatementRow } from "../lib/financials";

/**
 * 財報三表，**延後載入**。
 *
 * 刻意不放進 `/stock/:code` 的主流程：一次分析要查 3~5 檔，主流程已經有
 * 六個 FinMind 請求，再加三張報表就是每檔九個、一次分析 27~45 個請求。
 * FinMind 免費層有速率限制，那個尖峰會直接打到首次查詢。
 *
 * 財報是季頻、更新慢，而且只有 value 與 dividend 兩個視圖需要 ——
 * 由前端在使用者真的切到那些視圖時才請求，是這裡唯一划算的做法。
 */
const router = Router();

/** 三年約 12 季，足以看出毛利率與 ROE 的趨勢而不必抓整段歷史 */
const FUNDAMENTALS_MONTHS = 36;

const fundamentalsCache = dailyCacheFor<Financials>();

router.get("/stock/:code/fundamentals", async (req, res) => {
  const { code } = req.params;
  const token = process.env["FINMIND_TOKEN"];
  const day = today();
  const cacheKey = fundamentalsCacheKey(code);

  const cached = await fundamentalsCache.get(cacheKey, day);
  if (cached) {
    req.log.info({ code }, "Serving fundamentals from daily cache");
    res.json(cached);
    return;
  }

  try {
    const start = dateMinusMonths(FUNDAMENTALS_MONTHS);
    const [income, balance, cashflow] = await Promise.all([
      fetchFinMind<StatementRow>(
        buildUrl("TaiwanStockFinancialStatements", code, start, token),
      ),
      fetchFinMind<StatementRow>(buildUrl("TaiwanStockBalanceSheet", code, start, token)),
      fetchFinMind<StatementRow>(
        buildUrl("TaiwanStockCashFlowsStatement", code, start, token),
      ),
    ]);

    const financials = buildFinancials(income, balance, cashflow);

    // 只快取有內容的結果。三張表全空時多半是抓取失敗或代號無財報，
    // 把空結果鎖成當天的答案會讓使用者一整天都看不到資料。
    if (financials.quarters.length > 0) {
      await fundamentalsCache.set(cacheKey, day, financials);
    }

    res.json(financials);
  } catch (err) {
    req.log.error({ err, code }, "Fundamentals fetch failed");
    // 回空結果而非 500 —— 畫面對空資料的處理是整塊不渲染，
    // 而個股其餘部分完全不受影響，沒有理由讓它變成一個錯誤狀態。
    res.json({ quarters: [], asOf: null } satisfies Financials);
  }
});

export default router;
