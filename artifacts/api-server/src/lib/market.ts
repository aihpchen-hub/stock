/**
 * 大盤脈絡與相對強弱。
 *
 * 為什麼需要：`detectTrend` 判定「上升趨勢」看的是個股自己的均線。
 * 大盤同期漲 15%、個股漲 8%，畫面照樣寫「上升趨勢」—— 但它其實輸給大盤。
 * 大多頭時幾乎每檔都會站上雙均線、每檔都拿到高分，那是 beta 不是 alpha。
 *
 * 加權指數走的是**與個股完全相同的資料集**（`TaiwanStockPrice`，
 * `data_id=TAIEX`），因此沿用同一組 `PriceRow` 與 `indicators.ts`，
 * 不需要另一套解析。
 *
 * 純計算，不涉及 HTTP 也不讀環境變數，因此可獨立測試。
 * 這些數值**只做顯示，不進評分** —— 評分本來就未經回測，再塞進未驗證的
 * 權重只會讓它更難歸因（與 signals 同一個決定，見 signals.ts 的註解）。
 */

import { calcMA, calcReturn, type PriceRow } from "./indicators";

export type MarketMaSignal = "above_both" | "above_ma20" | "below_both" | "insufficient_data";

export interface Returns {
  /** 近 5 個交易日報酬（%） */
  d5: number | null;
  /** 近 20 個交易日報酬（%） */
  d20: number | null;
  /** 近 60 個交易日報酬（%） */
  d60: number | null;
}

export interface MarketContext {
  return5d: number | null;
  return20d: number | null;
  return60d: number | null;
  /** 加權指數自身的均線位置。below_both 即為系統性風險提示的觸發條件 */
  maSignal: MarketMaSignal;
  /** 大盤資料的最後日期 —— 與個股未必同步，因此各自標示 */
  asOf: string | null;
}

/** 三個天期一起算，避免呼叫端各自寫一份而選到不同的天數 */
export function buildReturns(closes: number[]): Returns {
  return {
    d5: calcReturn(closes, 5),
    d20: calcReturn(closes, 20),
    d60: calcReturn(closes, 60),
  };
}

export function buildMarketContext(rows: PriceRow[]): MarketContext {
  const closes = rows.map((r) => r.close).filter((c): c is number => Number.isFinite(c));
  const returns = buildReturns(closes);
  const last = closes[closes.length - 1] ?? null;
  const ma20 = calcMA(closes, 20);
  const ma60 = calcMA(closes, 60);

  // 與個股的 maSignal 用同一組判定，畫面才能並排陳述而不必解釋兩套標準
  let maSignal: MarketMaSignal = "insufficient_data";
  if (last !== null && ma20 !== null && ma60 !== null) {
    if (last >= ma20 && last >= ma60) maSignal = "above_both";
    else if (last >= ma20) maSignal = "above_ma20";
    else maSignal = "below_both";
  }

  return {
    return5d: returns.d5,
    return20d: returns.d20,
    return60d: returns.d60,
    maSignal,
    asOf: rows[rows.length - 1]?.date ?? null,
  };
}

/** 個股報酬減大盤報酬，單位是百分點。任一邊缺值即為 null —— 不當成零 */
export function buildRelativeStrength(stock: Returns, market: MarketContext): Returns {
  const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  return {
    d5: diff(stock.d5, market.return5d),
    d20: diff(stock.d20, market.return20d),
    d60: diff(stock.d60, market.return60d),
  };
}
