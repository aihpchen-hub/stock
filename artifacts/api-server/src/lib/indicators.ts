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
 * N 個交易日的報酬率（%）。
 *
 * 只取頭尾兩根收盤價 —— 中間怎麼走與「這段期間漲跌多少」無關。
 * 回傳百分比而非小數，與畫面上其他百分比欄位（月營收 YoY、E(V)）一致；
 * 少了這個約定，會在某一層被乘或除 100 兩次。
 *
 * 資料不足 days+1 根時回 null：拿短一截的區間硬湊，會讓不同標的的
 * 「20 日報酬」實際上是不同長度，相對強弱就失去意義。
 */
export function calcReturn(closes: number[], days: number): number | null {
  if (days <= 0) return null;
  if (closes.length < days + 1) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - days]!;
  if (!(then > 0) || !Number.isFinite(now)) return null;
  return ((now - then) / then) * 100;
}

/**
 * 平均真實振幅（Average True Range）。
 *
 * True Range 取「當日高低差」「當日高與前收之差」「當日低與前收之差」三者最大值，
 * 因此跳空缺口也會被計入 —— 這正是停損距離需要涵蓋的風險。
 * 資料不足 period+1 根時回傳 null。
 *
 * `exDates` 是除權息日（YYYY-MM-DD）。這些日子的跳空**不是風險**：
 * 股利離開股價與公司基本面無關，把它算進去會讓一檔 100 元、殖利率 7% 的股票
 * 在除息後 14 個交易日內 ATR 憑空墊高約 18%，停損距離同步拉寬、建議張數少約 15%。
 * 台股除息季集中在 7~9 月，而「存股」視圖的標的正好全是高殖利率股。
 * 當天仍取日內高低差 —— 除息當天真的大跌時，那一段是真的波動。
 *
 * 用的是 FinMind 的原始股價（TaiwanStockPrice）而非還原股價（…Adj）。
 * 換資料集是更徹底的解法，但需要不同的權限層級，且會一次改動所有既有數字；
 * 這裡先用已經抓回來的除息日把最傷的那一項修掉。
 */
export function calcATR(
  rows: PriceRow[],
  period = 14,
  exDates?: ReadonlySet<string>,
): number | null {
  if (rows.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i];
    const prev = rows[i - 1];
    if (!cur || !prev) continue;
    if (![cur.max, cur.min, prev.close].every((v) => typeof v === "number" && isFinite(v))) continue;
    if (exDates?.has(cur.date)) {
      trueRanges.push(cur.max - cur.min);
      continue;
    }
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

// ─── 指數移動平均與 MACD ────────────────────────────────────────────────────

/**
 * EMA 序列，以前 period 根的簡單平均為種子。
 *
 * 回傳整條序列而非只回最後一個值，因為 MACD 的 DEA 是「DIF 的 EMA」——
 * 少了中間過程就算不出來。序列的第 0 項對應原始資料的第 period-1 項。
 *
 * EMA 是遞迴的，種子的影響會隨資料變長而衰減但永遠不會歸零，
 * 因此餵進來的歷史越長越接近看盤軟體的數值。這也是抓取範圍
 * 從 150 個日曆日拉到 240 的原因。
 */
export function emaSeries(values: number[], period: number): number[] | null {
  if (period <= 0 || values.length < period) return null;

  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [seed];

  let ema = seed;
  for (let i = period; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

/** 最後一個 EMA 值 */
export function calcEMA(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series === null ? null : series[series.length - 1]!;
}

export type CrossKind = "golden" | "dead" | null;

/**
 * 交叉偵測。
 *
 * 只在最近 `within` 根之內發生交叉時才回報 —— 交叉是事件不是狀態。
 * 若改成永遠回報「目前快線在慢線之上」，三個月前的黃金交叉今天仍會
 * 被畫成新訊號，使用者無從分辨那是剛發生還是早就發生。
 */
export function detectCross(fast: number[], slow: number[], within = 3): CrossKind {
  const n = Math.min(fast.length, slow.length);
  if (n < 2) return null;

  // 兩條線各自取尾端對齊，長度不同時以較短的為準
  const f = fast.slice(fast.length - n);
  const s = slow.slice(slow.length - n);

  for (let i = n - 1; i >= Math.max(1, n - within); i--) {
    const prevDiff = f[i - 1]! - s[i - 1]!;
    const diff = f[i]! - s[i]!;
    if (prevDiff <= 0 && diff > 0) return "golden";
    if (prevDiff >= 0 && diff < 0) return "dead";
  }
  return null;
}

export interface Macd {
  /** 快慢 EMA 之差 */
  dif: number;
  /** DIF 的 9 期 EMA（訊號線） */
  dea: number;
  /** 柱體 = DIF − DEA */
  osc: number;
  cross: CrossKind;
}

/**
 * MACD。資料筆數不足以算出 DEA 時回傳 null，不用未收斂的值硬湊。
 *
 * 最少需要 slow + signal − 1 根（預設 34）才會有第一個 DEA 值。
 */
export function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): Macd | null {
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  if (fastSeries === null || slowSeries === null) return null;

  // 兩條 EMA 的起點不同（第 fast-1 根 vs 第 slow-1 根），對齊到較晚的那個
  const offset = fastSeries.length - slowSeries.length;
  const dif = slowSeries.map((slowVal, i) => fastSeries[i + offset]! - slowVal);

  const deaSeries = emaSeries(dif, signal);
  if (deaSeries === null) return null;

  const difTail = dif.slice(dif.length - deaSeries.length);
  const lastDif = difTail[difTail.length - 1]!;
  const lastDea = deaSeries[deaSeries.length - 1]!;

  return {
    dif: lastDif,
    dea: lastDea,
    osc: lastDif - lastDea,
    cross: detectCross(difTail, deaSeries),
  };
}

// ─── KD（隨機指標） ─────────────────────────────────────────────────────────

export interface Kd {
  k: number;
  d: number;
  cross: CrossKind;
}

/**
 * KD 隨機指標，台股慣用的 9-3-3。
 *
 * K 與 D 皆以 50 為種子遞迴平滑，與國內看盤軟體一致。
 * 最高最低相等（整段一價到底，如連續漲停）時 RSV 取 50 而非除以零。
 */
export function calcKD(rows: PriceRow[], period = 9, kPeriod = 3, dPeriod = 3): Kd | null {
  const valid = rows.filter(
    (r) => isFinite(r.close) && isFinite(r.max) && isFinite(r.min),
  );
  if (valid.length < period) return null;

  const kSeries: number[] = [];
  const dSeries: number[] = [];
  let k = 50;
  let d = 50;

  for (let i = period - 1; i < valid.length; i++) {
    const window = valid.slice(i - period + 1, i + 1);
    const high = Math.max(...window.map((r) => r.max));
    const low = Math.min(...window.map((r) => r.min));
    const rsv = high === low ? 50 : ((valid[i]!.close - low) / (high - low)) * 100;

    k = ((kPeriod - 1) / kPeriod) * k + (1 / kPeriod) * rsv;
    d = ((dPeriod - 1) / dPeriod) * d + (1 / dPeriod) * k;
    kSeries.push(k);
    dSeries.push(d);
  }

  return { k, d, cross: detectCross(kSeries, dSeries) };
}

// ─── 均線斜率 ───────────────────────────────────────────────────────────────

/**
 * 均線斜率：均線在 lookback 根之內的變化百分比。
 *
 * 用百分比而非絕對值，否則 2000 元的股票與 20 元的股票無法用同一個門檻。
 */
export function calcMASlope(closes: number[], period: number, lookback = 5): number | null {
  if (closes.length < period + lookback) return null;

  const now = calcMA(closes, period);
  const then = calcMA(closes.slice(0, closes.length - lookback), period);
  if (now === null || then === null || then === 0) return null;

  return ((now - then) / then) * 100;
}

// ─── 量能剖面 ───────────────────────────────────────────────────────────────

export type VolumeKind = "surge" | "expanding" | "normal" | "shrinking";

export interface VolumeProfile {
  /** 最近一個交易日的成交量（股） */
  latest: number;
  avg5: number | null;
  avg20: number;
  /** 最新量 ÷ 20 日均量 */
  ratio: number;
  kind: VolumeKind;
}

/**
 * 量能剖面。
 *
 * 只給 20 日均量無法回答「今天的量算不算異常」—— 那需要當日量與比值。
 * 分級門檻是慣用值、未經回測，與三情境機率同屬經驗設定。
 */
export function calcVolumeProfile(rows: PriceRow[]): VolumeProfile | null {
  const volumes = rows.map((r) => r.Trading_Volume).filter((v) => isFinite(v) && v > 0);
  if (volumes.length === 0) return null;

  const latest = volumes[volumes.length - 1]!;
  const avg20 = calcAvgVolume(rows, 20);
  if (avg20 === null || avg20 <= 0) return null;

  const ratio = latest / avg20;
  const kind: VolumeKind =
    ratio >= 2 ? "surge" : ratio >= 1.3 ? "expanding" : ratio >= 0.7 ? "normal" : "shrinking";

  return { latest, avg5: calcAvgVolume(rows, 5), avg20, ratio, kind };
}
