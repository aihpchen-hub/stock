/**
 * 估值區間與百分位。
 *
 * 只給「目前本益比 26.6」回答不了價值投資人真正要問的事：這個數字在它
 * 自己的歷史裡算高還是低。百分位把它放回五年區間 —— 第 80 百分位代表
 * 過去五年有八成的時間比現在便宜。
 *
 * 只回傳統計結果，**原始序列不外流**：五年日頻約 1,461 筆／檔，
 * 五檔就是 675 KB，而回應還要進 localStorage 快照。畫面需要的是
 * 「目前 26.6，位於五年區間第 68 百分位」，不是 1,461 個點。
 *
 * 純計算，可獨立測試。這些數值只做顯示，不進評分。
 */

export interface PerRow {
  date: string;
  PER: number | null;
  PBR: number | null;
  dividend_yield: number | null;
}

export interface MetricBand {
  current: number | null;
  /** 目前值高於歷史樣本的百分比（0~100）。樣本少於 2 筆時為 null */
  percentile: number | null;
  low: number | null;
  median: number | null;
  high: number | null;
  /** 實際參與計算的樣本數，讓畫面能標明「五年 1,461 個交易日」 */
  samples: number;
}

const EMPTY_BAND: MetricBand = {
  current: null,
  percentile: null,
  low: null,
  median: null,
  high: null,
  samples: 0,
};

/**
 * 濾掉不能用的樣本。
 *
 * 負值與非有限值一律排除：本益比為負代表公司虧損，那是「沒有本益比」
 * 而不是「本益比很低」，混進區間會把百分位整個算歪 —— 而那個歪掉的
 * 數字看起來完全正常。
 */
function usable(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
}

export function buildBand(values: Array<number | null | undefined>): MetricBand {
  const clean = usable(values);
  if (clean.length === 0) return { ...EMPTY_BAND };

  const current = clean[clean.length - 1]!;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;

  // 一個點構不成區間 —— 回 null 而非 0 或 100，那兩個值都會被誤讀成結論
  const percentile =
    clean.length < 2
      ? null
      : Math.round((sorted.filter((v) => v < current).length / (sorted.length - 1)) * 1000) / 10;

  return {
    current,
    percentile,
    low: sorted[0]!,
    median: Math.round(median * 100) / 100,
    high: sorted[sorted.length - 1]!,
    samples: clean.length,
  };
}

export interface Valuation {
  per: MetricBand;
  pbr: MetricBand;
  dividendYield: MetricBand;
  asOf: string | null;
}

export function buildValuation(rows: PerRow[]): Valuation {
  return {
    per: buildBand(rows.map((r) => r.PER)),
    pbr: buildBand(rows.map((r) => r.PBR)),
    dividendYield: buildBand(rows.map((r) => r.dividend_yield)),
    asOf: rows[rows.length - 1]?.date ?? null,
  };
}
