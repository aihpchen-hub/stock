/**
 * 綜合評分、三情境期望值與交易計畫 —— 純計算，可獨立測試。
 *
 * 期望值與交易計畫共用同一套 ATR 模型：空頭情境的價位「就是」停損，
 * 所以畫面上不會出現兩組互相矛盾的數字。
 */

import { roundToTick, tickSize } from "./ticks";

/** 台股一張 = 1000 股 */
export const SHARES_PER_LOT = 1000;

export const BEAR_ATR_MULTIPLE = -2;
export const BASE_ATR_MULTIPLE = 0.5;

/** 各分析週期約當的交易日數（一個月約 20 個交易日） */
export const PERIOD_TRADING_DAYS: Record<string, number> = { "1m": 20, "3m": 60, "6m": 120 };

/** 以 3 個月為基準週期，係數 1 */
const BASE_TRADING_DAYS = 60;

/**
 * 時間尺度係數。
 *
 * ATR 衡量的是**單日**波動，持有 N 個交易日的累積波動約為 ATR×√N ——
 * 波動度隨時間開根號放大，這是波動度縮放的標準假設。以 3 個月為基準：
 * 1 個月 √(20/60)=0.58、6 個月 √(120/60)=1.41。
 *
 * 停損與停利**同步**乘上這個係數，因此風險報酬比與三情境機率完全不變，
 * 只有絕對幅度隨持有期間伸縮。若只放大停利就得另訂一組隨週期改變的機率，
 * 那又是一組沒有驗證依據的臆測值。
 *
 * 這也是「分析週期」這個選項唯一誠實的實作方式：它先前只影響 AI 敘述的文字，
 * 1/3/6 個月算出來的停損停利完全相同，等於一個假的選項。
 */
export function horizonFactor(period?: string | null): number {
  const days = PERIOD_TRADING_DAYS[period ?? ""] ?? BASE_TRADING_DAYS;
  return Math.sqrt(days / BASE_TRADING_DAYS);
}

/** 多頭倍數隨綜合評分放大，所以風險報酬比 = 多頭倍數 / 2，介於 0.75 ~ 2.0 */
export function bullAtrMultiple(score: number): number {
  if (score >= 4) return 4.0;
  if (score >= 2) return 3.0;
  if (score >= 0) return 2.5;
  if (score >= -2) return 2.0;
  return 1.5;
}

export type EntryTiming = "now" | "wait_pullback" | "avoid" | "insufficient_data";

export type EvSignal = "strong_buy" | "buy" | "watch_positive" | "watch_negative" | "avoid";

export interface EVInput {
  revenueYoY: number | null;
  maSignal: string;
  currentPrice: number | null;
  ma20: number | null;
  ma60: number | null;
  atr: number | null;
  foreignNet30dShares: number;
  trustNet30dShares: number;
  /** 分析週期（1m/3m/6m）。未提供時以基準週期 3m 計算。 */
  period?: string | null;
}

export interface EVOutput {
  evScore: number;
  pBull: number;
  pBase: number;
  pBear: number;
  rBull: number;
  rBase: number;
  rBear: number;
  ev: number;
  evSignal: EvSignal;
  atrPct: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  /** 第一目標（1R，與停損等距）。停利落在 1R 以內時為 null。 */
  firstTarget: number | null;
  riskRewardRatio: number | null;
  riskPerLot: number | null;
  rewardPerLot: number | null;
  entryTiming: EntryTiming;
  /** 本次計算採用的時間尺度係數，讓畫面能說明幅度為何隨週期改變 */
  horizonFactor: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 營收動能 × 技術位置 × 法人籌碼，合計 -7 ~ 7 */
export function calcScore(input: EVInput): number {
  let score = 0;

  const yoy = input.revenueYoY ?? 0;
  if (yoy > 60) score += 3;
  else if (yoy > 30) score += 2;
  else if (yoy > 10) score += 1;
  else if (yoy < -20) score -= 2;
  else if (yoy < 0) score -= 1;

  if (input.maSignal === "above_both") score += 2;
  else if (input.maSignal === "above_ma20") score += 1;
  else if (input.maSignal === "below_both") score -= 2;

  const foreignZhang = input.foreignNet30dShares / 1000;
  if (foreignZhang > 2000) score += 2;
  else if (foreignZhang > 0) score += 1;
  else if (foreignZhang < -2000) score -= 2;
  else if (foreignZhang < 0) score -= 1;

  const trustZhang = input.trustNet30dShares / 1000;
  if (trustZhang > 500) score += 0.5;
  else if (trustZhang < -500) score -= 0.5;

  return score;
}

/** 三情境機率，依評分分五段。三者相加恆為 1。 */
export function scenarioProbabilities(score: number): {
  pBull: number;
  pBase: number;
  pBear: number;
} {
  if (score >= 4) return { pBull: 0.6, pBase: 0.3, pBear: 0.1 };
  if (score >= 2) return { pBull: 0.45, pBase: 0.4, pBear: 0.15 };
  if (score >= 0) return { pBull: 0.3, pBase: 0.45, pBear: 0.25 };
  if (score >= -2) return { pBull: 0.2, pBase: 0.45, pBear: 0.35 };
  return { pBull: 0.1, pBase: 0.35, pBear: 0.55 };
}

export function calcEV(input: EVInput): EVOutput {
  const score = calcScore(input);
  const { pBull, pBase, pBear } = scenarioProbabilities(score);

  // 情境幅度以 ATR 為單位，每檔股票對照自己的波動，
  // 因此同一評分帶的兩檔不會塌成一模一樣的期望值。
  const bullMultiple = bullAtrMultiple(score);
  const factor = horizonFactor(input.period);
  const atrPct =
    input.atr !== null && input.atr > 0 && input.currentPrice !== null && input.currentPrice > 0
      ? (input.atr / input.currentPrice) * 100
      : null;

  // 三情境幅度隨持有期間伸縮；三者同步縮放，故機率與風報比不受影響
  const rBull = atrPct === null ? 0 : round1(bullMultiple * atrPct * factor);
  const rBase = atrPct === null ? 0 : round1(BASE_ATR_MULTIPLE * atrPct * factor);
  const rBear = atrPct === null ? 0 : round1(BEAR_ATR_MULTIPLE * atrPct * factor);

  const ev = round1(pBull * rBull + pBase * rBase + pBear * rBear);

  let evSignal: EvSignal;
  if (ev > 8) evSignal = "strong_buy";
  else if (ev > 3) evSignal = "buy";
  else if (ev > -1) evSignal = "watch_positive";
  else if (ev > -5) evSignal = "watch_negative";
  else evSignal = "avoid";

  let entryLow: number | null = null;
  let entryHigh: number | null = null;
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;
  let firstTarget: number | null = null;
  let riskRewardRatio: number | null = null;
  let riskPerLot: number | null = null;
  let rewardPerLot: number | null = null;
  let entryTiming: EntryTiming = "insufficient_data";

  const { atr, currentPrice, ma20 } = input;
  if (atr !== null && atr > 0 && currentPrice !== null && ma20 !== null) {
    // 所有價位都取整到合法檔位 —— 下不出去的價格不該出現在交易計畫裡
    if (input.maSignal === "below_both") {
      // 跌破雙均線：不追。區間改為站回月線之上。
      entryTiming = "avoid";
      entryLow = roundToTick(ma20);
      entryHigh = roundToTick(ma20 + 0.3 * atr);
    } else {
      // 離月線超過兩個 ATR 視為追高。
      const chasing = currentPrice - ma20 > 2 * atr;

      // 站上均線：等回檔一個 ATR 之內，且不低於 MA20。
      entryLow = roundToTick(Math.min(Math.max(ma20, currentPrice - atr), currentPrice));

      if (chasing) {
        // 上緣必須確實低於現價，否則畫面一邊寫「等待回檔」、一邊給出含現價的區間。
        //
        // 只減 0.3×ATR 不夠：取整會把不到半個檔位的差距吃回去（1500 元的股票
        // 檔位是 5 元，0.3×ATR 常常連 1 元都不到），實測 24 種價位與波動組合中
        // 有 9 種會彈回現價。壓不下去時就取現價往下一個檔位 ——
        // 差一個檔位是「低於現價」的最小可下單表述。
        const capped = roundToTick(currentPrice - 0.3 * atr);
        const priceAtTick = roundToTick(currentPrice);
        entryHigh =
          capped < priceAtTick ? capped : roundToTick(priceAtTick - tickSize(priceAtTick));

        // 壓低上緣後可能低於下緣，此時下緣跟著下移。
        // 區間退化成單一價位仍然合法，且仍在現價之下。
        if (entryHigh < entryLow) entryLow = entryHigh;
      } else {
        entryHigh = roundToTick(currentPrice);
      }

      entryTiming = chasing ? "wait_pullback" : "now";
    }

    // 進場區間用未縮放的 ATR：那是「等回檔多少才進場」的即期問題，與持有期間無關。
    // 停損停利則隨持有期間伸縮 —— 抱 6 個月用 1 個月的停損距離，會在論點還沒
    // 走完前就被正常波動掃出場。
    const entryMid = (entryLow + entryHigh) / 2;
    stopLoss = roundToTick(entryMid + BEAR_ATR_MULTIPLE * atr * factor);
    takeProfit = roundToTick(entryMid + bullMultiple * atr * factor);

    const risk = entryMid - stopLoss;
    const reward = takeProfit - entryMid;
    if (risk > 0) {
      // 金額與風報比都由取整後的價位反推，畫面上的數字因此彼此對得起來
      riskRewardRatio = round1(reward / risk);
      riskPerLot = Math.round(risk * SHARES_PER_LOT);
      rewardPerLot = Math.round(reward * SHARES_PER_LOT);

      // 第一目標與停損等距（1R）。在此計算而非交給前端：停損距離會隨週期伸縮，
      // 兩邊各算一次就等於把同一個假設寫兩份，不同步時畫面上的「1R」會名不符實。
      // 評分偏低時多頭倍數不足 2，停利落在 1R 以內，分批出場沒有意義。
      const rawFirstTarget = roundToTick(entryMid + risk);
      firstTarget = takeProfit > rawFirstTarget ? rawFirstTarget : null;
    }
  }

  return {
    evScore: round1(score),
    pBull,
    pBase,
    pBear,
    rBull,
    rBase,
    rBear,
    ev,
    evSignal,
    atrPct: atrPct === null ? null : round2(atrPct),
    entryLow,
    entryHigh,
    stopLoss,
    takeProfit,
    firstTarget,
    riskRewardRatio,
    riskPerLot,
    rewardPerLot,
    entryTiming,
    horizonFactor: round2(factor),
  };
}
