/**
 * 三大法人籌碼的多天期彙總與趨勢判斷。
 *
 * FinMind 的 TaiwanStockInstitutionalInvestorsBuySell 本來就是逐日回傳，
 * 先前的程式把整段加總成單一個 30 日數字就丟掉了每日明細 ——
 * 而 30 日累積會被較久以前的資料稀釋：法人前 25 天大買、最近 5 天連續調節，
 * 累積數字仍是漂亮的正值，卻正好蓋掉使用者最需要知道的轉折。
 *
 * 這裡把每日淨額留下來，同時提供 1／5／10／20 個「交易日」的視窗。
 * 注意是交易日而非日曆日 —— 資料本身只有開市日，用日曆天數切會在
 * 連假後少算好幾天。
 *
 * 不涉及 HTTP、不讀環境變數，因此可獨立測試。
 */

/** FinMind 的單日單一法人別買賣記錄 */
export interface InstitutionalRow {
  date: string;
  name: string;
  buy: number;
  sell: number;
}

export type InvestorKind = "foreign" | "trust" | "dealer";

/** 單一交易日、三種法人別各自的淨買超（股數，可為負） */
export interface DailyNet {
  date: string;
  foreign: number;
  trust: number;
  dealer: number;
}

/**
 * 法人動向。方向（買／賣）與力道變化（加強／減弱）是兩個獨立的維度，
 * 交叉出來的四種狀態各自代表不同處境；另外把「近期翻向」單獨拉出來，
 * 因為那是累積數字最容易蓋掉、卻最該被看到的一種。
 */
export type ChipTrend =
  /** 20 日淨買超，且近 5 日的日均比 20 日日均更大 —— 買盤在加強 */
  | "accumulating"
  /** 20 日淨買超，但近 5 日日均已低於 20 日日均 —— 買盤在退潮 */
  | "slowing"
  /** 近 5 日明顯站在賣方，而 20 日累積並未支持這個方向 —— 態度剛轉變 */
  | "reversing_down"
  /** 20 日淨賣超，且近 5 日賣得更兇 —— 賣壓在加強 */
  | "distributing"
  /** 20 日淨賣超，但近 5 日賣壓已減輕 */
  | "easing"
  /** 近 5 日明顯站在買方，而 20 日累積並未支持這個方向 —— 態度剛轉變 */
  | "reversing_up"
  /** 長短天期的參與率都太低，方向沒有意義 */
  | "neutral"
  /** 不足 20 個交易日 */
  | "insufficient_data";

export interface ChipWindows {
  /** 最近一個交易日（股數）。null 代表資料不足該天期 */
  d1: number | null;
  d5: number | null;
  d10: number | null;
  d20: number | null;
}

export interface InvestorChips {
  windows: ChipWindows;
  trend: ChipTrend;
}

export interface Chips {
  /** 實際取得的交易日數，用於說明為何某些天期是 null */
  tradingDays: number;
  foreign: InvestorChips;
  trust: InvestorChips;
  dealer: InvestorChips;
}

/**
 * 法人別歸類。與先前 30 日加總所用的分類完全一致 ——
 * 外資含自營、自營商含避險部位。任何改動都會讓新舊數字對不起來。
 */
function bucketOf(name: string): InvestorKind | null {
  if (name === "Foreign_Investor" || name === "Foreign_Dealer_Self") return "foreign";
  if (name === "Investment_Trust") return "trust";
  if (name === "Dealer_self" || name === "Dealer_Hedging") return "dealer";
  return null;
}

/**
 * 逐日彙總，依日期由舊到新排序。
 *
 * FinMind 同一天會有多列（每個法人別一列），且不保證順序，
 * 因此以日期為鍵先聚合再排序，不能假設回傳已排好。
 */
export function toDailyNets(rows: InstitutionalRow[]): DailyNet[] {
  const byDate = new Map<string, DailyNet>();

  for (const row of rows) {
    const bucket = bucketOf(row.name ?? "");
    if (bucket === null) continue;

    const date = row.date;
    if (typeof date !== "string" || date === "") continue;

    let entry = byDate.get(date);
    if (entry === undefined) {
      entry = { date, foreign: 0, trust: 0, dealer: 0 };
      byDate.set(date, entry);
    }
    entry[bucket] += (row.buy ?? 0) - (row.sell ?? 0);
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 最近 n 個交易日的淨額合計。
 *
 * 不足 n 天回傳 null 而非用手上的幾天硬湊 —— 用 12 天的數字標成「20日」
 * 會讓使用者拿兩檔不同資料長度的股票直接相比。
 */
export function sumLastDays(
  series: DailyNet[],
  n: number,
  kind: InvestorKind,
): number | null {
  if (n <= 0 || series.length < n) return null;
  return series.slice(-n).reduce((acc, d) => acc + d[kind], 0);
}

/**
 * 一個視窗內的淨額要佔該期間總成交量多少，才算法人真的有在參與。
 *
 * 用「參與率」而非絕對張數，因為張數在大小型股之間完全不可比：
 * 外資買 500 張在中小型股是主導，在台積電是雜訊。
 * 除以 avgVolume20 × 天數，讓不同長度的視窗落在同一把尺上 ——
 * 這是關鍵：若改用「相當於幾天的量」這種只看 20 日的門檻，
 * 短天期的決斷動作會被長天期的平淡蓋掉，那正是 30 日累積的老毛病。
 */
const SIGNIFICANT_PARTICIPATION = 0.025;

function isSignificant(net: number, days: number, avgVolume20: number | null): boolean {
  // 成交量算不出來時無從衡量比例，此時只把完全打平視為無意義，
  // 其餘仍照方向陳述 —— 寧可少一層過濾，也不要因為缺一個輔助值就整個不說。
  if (avgVolume20 === null || avgVolume20 <= 0) return net !== 0;
  return Math.abs(net) / (avgVolume20 * days) >= SIGNIFICANT_PARTICIPATION;
}

export function judgeTrend(
  series: DailyNet[],
  kind: InvestorKind,
  avgVolume20: number | null,
): ChipTrend {
  const net20 = sumLastDays(series, 20, kind);
  const net5 = sumLastDays(series, 5, kind);
  if (net20 === null || net5 === null) return "insufficient_data";

  const sig20 = isSignificant(net20, 20, avgVolume20);
  const sig5 = isSignificant(net5, 5, avgVolume20);

  if (!sig20) {
    // 20 日打平但近 5 日出手，正是最該被講出來的一種：
    // 長天期看起來沒事，實際上法人剛剛改變態度。
    if (!sig5) return "neutral";
    return net5 > 0 ? "reversing_up" : "reversing_down";
  }

  const avg5 = net5 / 5;
  const avg20 = net20 / 20;

  if (net20 > 0) {
    // 翻向要看得夠明顯才算，否則只是幾天雜訊把符號翻過去
    if (net5 < 0 && sig5) return "reversing_down";
    return avg5 > avg20 ? "accumulating" : "slowing";
  }
  if (net5 > 0 && sig5) return "reversing_up";
  return avg5 < avg20 ? "distributing" : "easing";
}

function chipsFor(
  series: DailyNet[],
  kind: InvestorKind,
  avgVolume20: number | null,
): InvestorChips {
  return {
    windows: {
      d1: sumLastDays(series, 1, kind),
      d5: sumLastDays(series, 5, kind),
      d10: sumLastDays(series, 10, kind),
      d20: sumLastDays(series, 20, kind),
    },
    trend: judgeTrend(series, kind, avgVolume20),
  };
}

export function buildChips(rows: InstitutionalRow[], avgVolume20: number | null): Chips {
  const series = toDailyNets(rows);
  return {
    tradingDays: series.length,
    foreign: chipsFor(series, "foreign", avgVolume20),
    trust: chipsFor(series, "trust", avgVolume20),
    dealer: chipsFor(series, "dealer", avgVolume20),
  };
}
