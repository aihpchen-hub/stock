/**
 * 股利政策與填息紀錄。
 *
 * 存股族的核心問題是「它撐不撐得住」，而那要看連續配息的年數與填息能力，
 * 不是月營收 YoY。這一塊是這個 App 先前對存股族完全沒有的東西 ——
 * 舊畫面上唯一的基本面欄位是單月營收年增率，那恰好是存股族最不會拿來
 * 決策的數字之一。
 *
 * 年度一律取 `date` 的西元年。FinMind 的 `year` 欄位是民國格式
 * （`"93年"`、`"113年第3季"`），拿來排序或比較都會錯。
 */

export interface DividendRow {
  date: string;
  CashEarningsDistribution: number | null;
  StockEarningsDistribution: number | null;
}

export interface DividendResultRow {
  date: string;
  before_price: number | null;
  after_price: number | null;
  /** 除息後至今的最高價 —— 用來判定是否填息 */
  max_price: number | null;
}

export interface DividendSummary {
  /** 從最新年度往回數的連續配息年數 */
  consecutiveYears: number;
  latestYear: string | null;
  /** 最近一個有配息年度的現金股利合計（季配會有多筆） */
  latestCash: number | null;
  /** 近五個有配息年度的平均現金股利 */
  avgCash5y: number | null;
  /** 資料涵蓋的最早年度。文案只能寫「N 年起」，不能宣稱完整歷史 */
  coverageFrom: string | null;
  /** 填息成功次數 */
  filled: number;
  /** 可判定的除息次數（缺價位者不計） */
  filledTotal: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildDividend(
  rows: DividendRow[],
  results: DividendResultRow[],
): DividendSummary {
  // 依西元年彙總現金股利。季配的公司同一年會有多筆，必須加總而非取其一。
  const byYear = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.date !== "string" || r.date.length < 4) continue;
    const year = r.date.slice(0, 4);
    const cash =
      r.CashEarningsDistribution != null && Number.isFinite(r.CashEarningsDistribution)
        ? r.CashEarningsDistribution
        : 0;
    byYear.set(year, (byYear.get(year) ?? 0) + cash);
  }

  const years = [...byYear.keys()].sort();
  const paidYears = years.filter((y) => (byYear.get(y) ?? 0) > 0);
  const latestYear = paidYears[paidYears.length - 1] ?? null;

  // 從最新的有配息年度往回數，遇到斷層即停。
  //
  // 直接算「有配息的年數」會把中間缺一年的情況算成連續 —— 實測 2412 中華電
  // 2009 年缺席，總年數 21 但連續只有 17。那不是同一件事，而「連續配息 N 年」
  // 正是存股族拿來判斷穩定度的那個數字。
  let consecutiveYears = 0;
  if (latestYear !== null) {
    let cursor = Number(latestYear);
    while ((byYear.get(String(cursor)) ?? 0) > 0) {
      consecutiveYears += 1;
      cursor -= 1;
    }
  }

  const last5 = paidYears.slice(-5).map((y) => byYear.get(y)!);
  const avgCash5y =
    last5.length > 0 ? round2(last5.reduce((a, b) => a + b, 0) / last5.length) : null;

  // 填息：除息後的最高價曾回到除息前價位即算填息。
  // 缺任一價位者不計入分母 —— 判不出來不該算成失敗。
  let filled = 0;
  let filledTotal = 0;
  for (const r of results) {
    if (
      r.before_price == null ||
      r.max_price == null ||
      !Number.isFinite(r.before_price) ||
      !Number.isFinite(r.max_price)
    ) {
      continue;
    }
    filledTotal += 1;
    if (r.max_price >= r.before_price) filled += 1;
  }

  return {
    consecutiveYears,
    latestYear,
    latestCash: latestYear !== null ? round2(byYear.get(latestYear)!) : null,
    avgCash5y,
    coverageFrom: years[0] ?? null,
    filled,
    filledTotal,
  };
}
