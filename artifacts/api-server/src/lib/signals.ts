/**
 * 由已算出的指標推出「可以顯示給人看」的訊號清單與趨勢判定。
 *
 * 這些訊號**只做顯示，不進入評分公式**。評分本來就是未經回測的經驗設定，
 * 再塞進五個同樣未驗證的權重只會讓它更難歸因。訊號的價值在於讓使用者
 * 看見判斷依據 —— 顯示出來就已經達成那個目的。
 *
 * 命名用「訊號依據」而非使用者原本說的「AI 推薦原因」：這些全部由程式
 * 規則算出，不是模型判斷。而且 Gemini 的呼叫發生在抓取個股資料**之前**，
 * 模型從未看過任何價格數字，要它列出這些條件必然是幻覺。
 * 每一條都可以用回傳的數值驗算。
 *
 * 不涉及 HTTP、不讀環境變數，因此可獨立測試。
 */

import type { Chips } from "./chips";
import { calcMA, calcMASlope, type Kd, type Macd, type PriceRow, type VolumeProfile } from "./indicators";

/**
 * 訊號方向。
 *
 * 規格原本只給 bullish／bearish，但爆量與量縮本身並不指向任何一邊 ——
 * 爆量可以是突破也可以是出貨。硬塞進二選一會讓畫面陳述一個資料
 * 支持不了的方向，因此多一個 neutral。
 */
export type SignalDirection = "bullish" | "bearish" | "neutral";

export interface Signal {
  key: string;
  label: string;
  direction: SignalDirection;
  /** 可供驗算的具體數值 */
  detail: string;
}

export type Trend = "uptrend" | "downtrend" | "range";

export interface TrendResult {
  trend: Trend;
  /** 判定依據，直接寫出三個條件的實際值 */
  basis: string;
}

export interface SignalInput {
  closes: number[];
  rows: PriceRow[];
  ma20: number | null;
  ma60: number | null;
  macd: Macd | null;
  kd: Kd | null;
  volume: VolumeProfile | null;
  chips: Chips | null;
  revenueYoY: number | null;
}

const n1 = (v: number) => v.toFixed(1);
const n2 = (v: number) => v.toFixed(2);
/** 股數換算成張 */
const lots = (shares: number) => Math.round(shares / 1000).toLocaleString();

/**
 * 均線多空排列。
 *
 * MA5／MA10 只在這裡用得到，因此就地算而不進 payload ——
 * 排列本身就是結論，四個均線數字對使用者沒有額外意義。
 */
function maStackSignal(closes: number[]): Signal | null {
  const ma5 = calcMA(closes, 5);
  const ma10 = calcMA(closes, 10);
  const ma20 = calcMA(closes, 20);
  const ma60 = calcMA(closes, 60);
  if (ma5 === null || ma10 === null || ma20 === null || ma60 === null) return null;

  const detail = `MA5 ${n1(ma5)}／MA10 ${n1(ma10)}／MA20 ${n1(ma20)}／MA60 ${n1(ma60)}`;

  if (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) {
    return { key: "ma_bull_stack", label: "均線多頭排列", direction: "bullish", detail };
  }
  if (ma5 < ma10 && ma10 < ma20 && ma20 < ma60) {
    return { key: "ma_bear_stack", label: "均線空頭排列", direction: "bearish", detail };
  }
  return null;
}

/**
 * 法人連續買賣超。
 *
 * 規格的表格只列了「連買」，但那會讓籌碼訊號系統性地只出現在偏多的一側 ——
 * 連賣 8 天的股票一條訊號都不會有，連買 3 天的卻有。其餘每一項
 * （均線排列、MACD、KD）規格都是多空成對的，這裡照同樣的方式補上連賣。
 */
function streakSignal(
  key: string,
  who: string,
  streak: number | undefined,
  threshold = 3,
): Signal | null {
  if (streak === undefined || Math.abs(streak) < threshold) return null;
  const days = Math.abs(streak);
  return streak > 0
    ? { key, label: `${who}連買 ${days} 日`, direction: "bullish", detail: `連續 ${days} 個交易日淨買超` }
    : { key, label: `${who}連賣 ${days} 日`, direction: "bearish", detail: `連續 ${days} 個交易日淨賣超` };
}

export function detectSignals(input: SignalInput): Signal[] {
  const { closes, rows, macd, kd, volume, chips, revenueYoY } = input;
  const out: Signal[] = [];

  const stack = maStackSignal(closes);
  if (stack) out.push(stack);

  if (macd) {
    const detail = `DIF ${n2(macd.dif)}／DEA ${n2(macd.dea)}／柱體 ${n2(macd.osc)}`;
    if (macd.cross === "golden") {
      out.push({ key: "macd_golden", label: "MACD 黃金交叉", direction: "bullish", detail });
    } else if (macd.cross === "dead") {
      out.push({ key: "macd_dead", label: "MACD 死亡交叉", direction: "bearish", detail });
    }
  }

  if (kd) {
    const detail = `K ${n1(kd.k)}／D ${n1(kd.d)}`;
    // 交叉發生在高（低）檔時參考價值大減，故加上 K 值的位置限制
    if (kd.cross === "golden" && kd.k < 80) {
      out.push({ key: "kd_golden", label: "KD 黃金交叉", direction: "bullish", detail });
    } else if (kd.cross === "dead" && kd.k > 20) {
      out.push({ key: "kd_dead", label: "KD 死亡交叉", direction: "bearish", detail });
    }
    if (kd.k > 80) {
      out.push({ key: "kd_overbought", label: "KD 高檔鈍化", direction: "bearish", detail });
    }
  }

  const foreign = streakSignal("foreign_streak", "外資", chips?.foreign?.streak);
  if (foreign) out.push(foreign);
  const trust = streakSignal("trust_streak", "投信", chips?.trust?.streak);
  if (trust) out.push(trust);

  if (volume) {
    const detail = `${lots(volume.latest)}張，為 20 日均量的 ${n2(volume.ratio)} 倍`;
    if (volume.kind === "surge") {
      // 爆量不指向任何一邊：可以是突破起漲，也可以是高檔出貨
      out.push({ key: "volume_surge", label: "爆量", direction: "neutral", detail });
    } else if (volume.kind === "shrinking") {
      out.push({ key: "volume_dry", label: "量縮整理", direction: "neutral", detail });
    }

    // 量增突破要同時看價 —— 只有量沒有價，那是換手不是突破。
    // 用收盤價創新高而非盤中高點：盤中觸及後拉回收黑不構成突破。
    const recent = closes.slice(-20);
    const latestClose = closes[closes.length - 1];
    if (
      volume.ratio >= 1.3 &&
      recent.length === 20 &&
      latestClose !== undefined &&
      latestClose >= Math.max(...recent)
    ) {
      out.push({
        key: "volume_breakout",
        label: "量增突破",
        direction: "bullish",
        detail: `量為均量 ${n2(volume.ratio)} 倍，且收盤 ${n1(latestClose)} 創近 20 日收盤新高`,
      });
    }
  }

  if (revenueYoY !== null && revenueYoY > 30) {
    out.push({
      key: "revenue_growth",
      label: `營收年增 ${n1(revenueYoY)}%`,
      direction: "bullish",
      detail: "最近一個月營收較去年同月成長逾三成",
    });
  }

  // rows 目前只用於未來擴充；顯式忽略以免被誤刪
  void rows;

  return out;
}

/**
 * 趨勢判定。
 *
 * 三個條件同時成立才算趨勢：均線相對位置、均線斜率、收盤價相對月線。
 * 少了斜率，一檔剛跌破月線但月線仍在年線之上的股票會被判成上升趨勢；
 * 少了收盤價位置，股價已跌破月線卻因均線尚未翻下而仍稱上升。
 * 其餘一律 range —— 不硬把盤整說成趨勢。
 */
export function detectTrend(
  closes: number[],
  ma20: number | null,
  ma60: number | null,
): TrendResult {
  const slope = calcMASlope(closes, 20);
  const close = closes[closes.length - 1];

  if (ma20 === null || ma60 === null || slope === null || close === undefined) {
    return { trend: "range", basis: "資料不足以判定趨勢" };
  }

  const basis = `MA20 ${n1(ma20)}／MA60 ${n1(ma60)}／MA20 近 5 日斜率 ${slope >= 0 ? "+" : ""}${n1(slope)}%／收盤 ${n1(close)}`;

  if (ma20 > ma60 && slope > 0 && close > ma20) return { trend: "uptrend", basis };
  if (ma20 < ma60 && slope < 0 && close < ma20) return { trend: "downtrend", basis };
  return { trend: "range", basis };
}
