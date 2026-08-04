/**
 * 財報三表的長格式轉換與品質比率。
 *
 * FinMind 的三張報表回傳的是**長格式** —— 一列一個科目
 * （`{date, type: "GrossProfit", value: 600, origin_name: "營業毛利"}`），
 * 不是一列一季。要算任何比率都得先 pivot 成「一季一物件」。
 *
 * ROE 必須跨兩張表（稅後淨利 ÷ 股東權益），這是為什麼三張表要一起處理
 * 而不是各自算完再合併。
 *
 * 缺科目或分母為零時該比率為 null —— 用零硬湊會產生看起來完全正常的
 * 假數字，而財報比率正是使用者最不會去複查的那一種。
 *
 * 這些數字取代了「護城河敘述」：模型的形容詞不可驗算，毛利率五年趨勢可以。
 */

export interface StatementRow {
  date: string;
  type: string;
  value: number | null;
}

export interface QuarterMetrics {
  date: string;
  /** 毛利率（%） */
  grossMargin: number | null;
  /** 營益率（%） */
  operatingMargin: number | null;
  /** 淨利率（%） */
  netMargin: number | null;
  eps: number | null;
  /** 股東權益報酬率（%）。單季值，非年化 —— 畫面必須標明 */
  roe: number | null;
  /** 負債比（%） */
  debtRatio: number | null;
  /**
   * 自由現金流 = 營運現金流 − 資本支出，**單季值**。
   *
   * 原始的現金流量表是累計數（Q4 是全年），已在此還原成單季，
   * 才能與同一列的單季毛利率對照。無法還原時為 null。
   */
  fcf: number | null;
}

export interface Financials {
  /** 由新到舊 */
  quarters: QuarterMetrics[];
  asOf: string | null;
}

/** 長格式 → Map<date, Map<type, value>> */
function pivot(rows: StatementRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (typeof r.date !== "string" || typeof r.type !== "string") continue;
    if (r.value == null || !Number.isFinite(r.value)) continue;
    const q = out.get(r.date) ?? new Map<string, number>();
    q.set(r.type, r.value);
    out.set(r.date, q);
  }
  return out;
}

/** 由日期推出會計季別。台股財報日期固定落在 3/31、6/30、9/30、12/31 */
function quarterOf(date: string): 1 | 2 | 3 | 4 | null {
  const month = date.slice(5, 7);
  if (month === "03") return 1;
  if (month === "06") return 2;
  if (month === "09") return 3;
  if (month === "12") return 4;
  return null;
}

/**
 * 把累計的現金流量表還原成單季。
 *
 * **現金流量表是累計數，損益表是單季** —— 實測 2330：
 *   現金流 2024 Q1 4,363 億 → Q2 8,140 → Q3 12,060 → Q4 18,262，2025 Q1 重置
 *   損益表 2024 Q1 5,926 億 → Q2 6,735 → Q3 7,597 → Q4 8,685（年營收 2.9 兆）
 *
 * 不還原就會把「全年自由現金流」擺在「單季毛利率」旁邊，而那一列看起來
 * 完全正常 —— 使用者不會發現同一列的兩個數字算的是不同長度的期間。
 *
 * 非第一季而又拿不到同年前一季時整季略過：那筆仍是累計值，印出來就是錯的，
 * 而「少一格」遠比「錯一格」安全。
 */
function decumulate(rows: StatementRow[]): Map<string, Map<string, number>> {
  const byDate = pivot(rows);
  const dates = [...byDate.keys()].sort();
  const out = new Map<string, Map<string, number>>();

  dates.forEach((date, i) => {
    const current = byDate.get(date)!;
    const quarter = quarterOf(date);
    if (quarter === null) return;

    if (quarter === 1) {
      out.set(date, current);
      return;
    }

    const prev = i > 0 ? dates[i - 1]! : null;
    const sameYear = prev !== null && prev.slice(0, 4) === date.slice(0, 4);
    if (!sameYear) return;

    const before = byDate.get(prev!)!;
    const single = new Map<string, number>();
    for (const [type, value] of current) {
      const previous = before.get(type);
      if (previous == null) continue;
      single.set(type, value - previous);
    }
    out.set(date, single);
  });

  return out;
}

/** 比率（%）。分母缺席或為零時回 null，不產生 Infinity 也不用零硬湊 */
function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Math.round((numerator / denominator) * 100 * 100) / 100;
}

export function buildFinancials(
  income: StatementRow[],
  balance: StatementRow[],
  cashflow: StatementRow[],
): Financials {
  const inc = pivot(income);
  const bal = pivot(balance);
  // 現金流量表是累計數，必須先還原成單季才能與損益表的單季比率並排
  const cf = decumulate(cashflow);

  // 以損益表的季別為準：沒有損益表就算不出任何一個比率
  const dates = [...inc.keys()].sort().reverse();

  const quarters: QuarterMetrics[] = dates.map((date) => {
    const i = inc.get(date);
    const b = bal.get(date);
    const c = cf.get(date);

    const revenue = i?.get("Revenue");
    const netIncome = i?.get("IncomeAfterTaxes");
    const operating = c?.get("NetCashInflowFromOperatingActivities");
    // FinMind 的資本支出是負數（現金流出）。直接相加會變成加總而非相減，
    // 算出來的自由現金流會比實際大一倍以上。
    const capex = c?.get("PropertyAndPlantAndEquipment");
    const eps = i?.get("EPS");

    return {
      date,
      grossMargin: ratio(i?.get("GrossProfit"), revenue),
      operatingMargin: ratio(i?.get("OperatingIncome"), revenue),
      netMargin: ratio(netIncome, revenue),
      eps: eps != null && Number.isFinite(eps) ? eps : null,
      roe: ratio(netIncome, b?.get("Equity")),
      debtRatio: ratio(b?.get("Liabilities"), b?.get("TotalAssets")),
      fcf: operating != null && capex != null ? Math.round(operating - Math.abs(capex)) : null,
    };
  });

  return { quarters, asOf: dates[0] ?? null };
}
