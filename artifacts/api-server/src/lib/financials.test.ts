import { describe, expect, it } from "vitest";

import { buildFinancials, type StatementRow } from "./financials";

const row = (date: string, type: string, value: number): StatementRow => ({ date, type, value });

const income = [
  row("2025-03-31", "Revenue", 1000),
  row("2025-03-31", "GrossProfit", 600),
  row("2025-03-31", "OperatingIncome", 400),
  row("2025-03-31", "IncomeAfterTaxes", 300),
  row("2025-03-31", "EPS", 12.5),
];
const balance = [
  row("2025-03-31", "Equity", 3000),
  row("2025-03-31", "Liabilities", 2000),
  row("2025-03-31", "TotalAssets", 5000),
];
const cashflow = [
  row("2025-03-31", "NetCashInflowFromOperatingActivities", 500),
  row("2025-03-31", "PropertyAndPlantAndEquipment", -200),
];

describe("buildFinancials", () => {
  it("把長格式的一列一科目轉成一季一物件", () => {
    const f = buildFinancials(income, balance, cashflow);
    expect(f.quarters).toHaveLength(1);
    expect(f.quarters[0]!.date).toBe("2025-03-31");
  });

  it("毛利率、營益率、淨利率都以營收為分母", () => {
    const q = buildFinancials(income, balance, cashflow).quarters[0]!;
    expect(q.grossMargin).toBeCloseTo(60, 6);
    expect(q.operatingMargin).toBeCloseTo(40, 6);
    expect(q.netMargin).toBeCloseTo(30, 6);
  });

  it("ROE 需要跨損益表與資產負債表兩張表", () => {
    expect(buildFinancials(income, balance, cashflow).quarters[0]!.roe).toBeCloseTo(10, 6);
  });

  it("負債比以總資產為分母", () => {
    expect(buildFinancials(income, balance, cashflow).quarters[0]!.debtRatio).toBeCloseTo(40, 6);
  });

  it("自由現金流是營運現金流減資本支出，資本支出取絕對值", () => {
    // FinMind 的資本支出是負數（現金流出）。直接相加會變成加總，
    // 算出來的自由現金流會比實際大一倍以上。
    expect(buildFinancials(income, balance, cashflow).quarters[0]!.fcf).toBeCloseTo(300, 6);
  });

  it("EPS 直接取用，不自己除股數", () => {
    expect(buildFinancials(income, balance, cashflow).quarters[0]!.eps).toBeCloseTo(12.5, 6);
  });

  it("缺科目時該比率為 null，不用零硬湊", () => {
    const q = buildFinancials([row("2025-03-31", "Revenue", 1000)], [], []).quarters[0]!;
    expect(q.grossMargin).toBeNull();
    expect(q.roe).toBeNull();
    expect(q.fcf).toBeNull();
  });

  it("分母為零時回 null 而非 Infinity", () => {
    const f = buildFinancials(
      [
        row("2025-03-31", "Revenue", 0),
        row("2025-03-31", "GrossProfit", 600),
        row("2025-03-31", "IncomeAfterTaxes", 300),
      ],
      [row("2025-03-31", "Equity", 0)],
      [],
    );
    expect(f.quarters[0]!.grossMargin).toBeNull();
    expect(f.quarters[0]!.roe).toBeNull();
  });

  it("多季時由新到舊排序，asOf 為最新一季", () => {
    const two = [
      ...income,
      row("2025-06-30", "Revenue", 2000),
      row("2025-06-30", "GrossProfit", 1000),
    ];
    const f = buildFinancials(two, balance, cashflow);
    expect(f.quarters[0]!.date).toBe("2025-06-30");
    expect(f.quarters[1]!.date).toBe("2025-03-31");
    expect(f.asOf).toBe("2025-06-30");
  });

  it("以損益表的季別為準 —— 沒有損益表就算不出任何比率", () => {
    expect(buildFinancials([], balance, cashflow).quarters).toEqual([]);
  });

  it("非有限值的科目視同缺席", () => {
    const q = buildFinancials(
      [row("2025-03-31", "Revenue", Number.NaN), row("2025-03-31", "GrossProfit", 600)],
      [],
      [],
    ).quarters[0]!;
    expect(q.grossMargin).toBeNull();
  });

  it("空輸入不崩潰", () => {
    const f = buildFinancials([], [], []);
    expect(f.quarters).toEqual([]);
    expect(f.asOf).toBeNull();
  });
});

describe("現金流量表的累計還原", () => {
  /** 損益表提供季別骨架；金額不影響本組測試 */
  const skeleton = (dates: string[]) => dates.map((d) => row(d, "Revenue", 1000));

  /** 累計的營運現金流與資本支出（資本支出為負，與 FinMind 一致） */
  const cumulative = (entries: Array<[string, number, number]>) =>
    entries.flatMap(([date, op, capex]) => [
      row(date, "NetCashInflowFromOperatingActivities", op),
      row(date, "PropertyAndPlantAndEquipment", capex),
    ]);

  it("第一季就是單季，直接採用", () => {
    const f = buildFinancials(
      skeleton(["2024-03-31"]),
      [],
      cumulative([["2024-03-31", 4363, -1813]]),
    );
    expect(f.quarters[0]!.fcf).toBe(4363 - 1813);
  });

  it("第二季之後要減掉同年前一季 —— 不減就會把全年數當成單季", () => {
    // 2330 的真實形狀：現金流是累計，Q4 的數字是全年
    const f = buildFinancials(
      skeleton(["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"]),
      [],
      cumulative([
        ["2024-03-31", 4363, -1813],
        ["2024-06-30", 8140, -3870],
        ["2024-09-30", 12060, -5941],
        ["2024-12-31", 18262, -9560],
      ]),
    );
    const byDate = Object.fromEntries(f.quarters.map((q) => [q.date, q.fcf]));
    expect(byDate["2024-03-31"]).toBe(4363 - 1813);
    expect(byDate["2024-06-30"]).toBe(8140 - 4363 - (3870 - 1813));
    expect(byDate["2024-09-30"]).toBe(12060 - 8140 - (5941 - 3870));
    expect(byDate["2024-12-31"]).toBe(18262 - 12060 - (9560 - 5941));
  });

  it("跨年時重新起算 —— 隔年第一季不減去前一年第四季", () => {
    const f = buildFinancials(
      skeleton(["2024-12-31", "2025-03-31"]),
      [],
      cumulative([
        ["2024-12-31", 18262, -9560],
        ["2025-03-31", 6256, -3308],
      ]),
    );
    const byDate = Object.fromEntries(f.quarters.map((q) => [q.date, q.fcf]));
    expect(byDate["2025-03-31"]).toBe(6256 - 3308);
  });

  it("非第一季而拿不到同年前一季時該季自由現金流為 null —— 少一格勝過錯一格", () => {
    // 抓取視窗從第三季開始，那筆仍是九個月累計，還原不了
    const f = buildFinancials(
      skeleton(["2024-09-30"]),
      [],
      cumulative([["2024-09-30", 12060, -5941]]),
    );
    expect(f.quarters[0]!.fcf).toBeNull();
  });

  it("季別認不得的日期不參與還原", () => {
    const f = buildFinancials(
      skeleton(["2024-05-15"]),
      [],
      cumulative([["2024-05-15", 100, -50]]),
    );
    expect(f.quarters[0]!.fcf).toBeNull();
  });
});
