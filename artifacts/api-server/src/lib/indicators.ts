/**
 * 純技術指標計算 —— 不涉及 HTTP、不讀環境變數，因此可獨立測試。
 * 所有函式在資料不足時回傳 null，讓呼叫端以「資料不足」處理而非給出假數字。
 */

export interface PriceRow {
  date: string;
  close: number;
  /** FinMind 的日高 */
  max: number;
  /** FinMind 的日低 */
  min: number;
  /** 成交股數 */
  Trading_Volume: number;
}

export function calcMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * 平均真實振幅（Average True Range）。
 *
 * True Range 取「當日高低差」「當日高與前收之差」「當日低與前收之差」三者最大值，
 * 因此跳空缺口也會被計入 —— 這正是停損距離需要涵蓋的風險。
 * 資料不足 period+1 根時回傳 null。
 */
export function calcATR(rows: PriceRow[], period = 14): number | null {
  if (rows.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i];
    const prev = rows[i - 1];
    if (!cur || !prev) continue;
    if (![cur.max, cur.min, prev.close].every((v) => typeof v === "number" && isFinite(v))) continue;
    trueRanges.push(
      Math.max(
        cur.max - cur.min,
        Math.abs(cur.max - prev.close),
        Math.abs(cur.min - prev.close),
      ),
    );
  }

  if (trueRanges.length < period) return null;
  const recent = trueRanges.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / period;
}

/** 近 N 根的最高價與最低價 —— 停損位置的結構性對照，以及壓力參考 */
export function calcSwing(
  rows: PriceRow[],
  period = 20,
): { high: number | null; low: number | null } {
  const recent = rows.slice(-period).filter((r) => isFinite(r.max) && isFinite(r.min));
  if (recent.length === 0) return { high: null, low: null };
  return {
    high: Math.max(...recent.map((r) => r.max)),
    low: Math.min(...recent.map((r) => r.min)),
  };
}

/** 近 N 日平均成交量（股）。用來把法人買賣超換算成「幾日均量」才有比較基準。 */
export function calcAvgVolume(rows: PriceRow[], period = 20): number | null {
  const recent = rows
    .slice(-period)
    .map((r) => r.Trading_Volume)
    .filter((v) => isFinite(v) && v > 0);
  if (recent.length === 0) return null;
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

/**
 * 吊燈出場法的倍數。停損從「部位高點」往下掛，股價創新高時跟著上移。
 * 比初始停損寬（2.5 vs 2），因為部位已有獲利緩衝，不該被正常回檔洗掉。
 */
export const TRAILING_ATR_MULTIPLE = 2.5;

/**
 * 移動停損：部位高點往下掛 2.5 個 ATR，只升不降。
 *
 * `highWaterMark` 必須是**這個部位**的最高價，規劃階段即為進場價 ——
 * 不可用近 20 日最高價。3017 的近 20 日高是 2790 而進場區在 2382，
 * 拿 2790 起算會得到 2543 的移動停損，比進場價還高，一進場就出場；
 * 那個高點是進場之前做出來的，不屬於這個部位。
 *
 * `factor` 是分析週期的時間尺度係數，必須與初始停損用同一個 ——
 * 初始停損隨週期放大而移動停損不放大時，長週期會出現「移動停損比初始停損還緊」
 * 的矛盾，與「已有獲利緩衝所以掛得更寬」的設計意圖正好相反。
 *
 * 兩者共用係數時恆有 2.5 > 2，移動停損永遠比初始停損寬，因此在部位獲利之前
 * 都不會先觸發，畫面上的「每張最大虧損」才與停損價一致。
 */
export function calcTrailingStop(
  highWaterMark: number | null,
  atr: number | null,
  factor = 1,
): number | null {
  if (highWaterMark === null || atr === null || atr <= 0) return null;
  return Math.round((highWaterMark - TRAILING_ATR_MULTIPLE * atr * factor) * 100) / 100;
}
