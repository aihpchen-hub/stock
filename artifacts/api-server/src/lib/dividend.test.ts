import { describe, expect, it } from "vitest";

import { buildDividend, type DividendResultRow, type DividendRow } from "./dividend";

const cash = (date: string, amount: number): DividendRow => ({
  date,
  CashEarningsDistribution: amount,
  StockEarningsDistribution: 0,
});

describe("buildDividend", () => {
  it("連續配息年數從最新年度往回數到斷層為止", () => {
    // 2412 中華電的真實形狀：2005~2008 有、2009 缺、2010 之後連續。
    // 直接算「有配息的年數」會得到 8，但連續只有 4 年 —— 這正是
    // 「連續配息 N 年」這句文案必須算對的原因。
    const rows = [
      cash("2005-08-01", 4.7),
      cash("2006-08-01", 4.3),
      cash("2007-08-01", 3.58),
      cash("2008-08-01", 4.26),
      cash("2010-08-01", 4.06),
      cash("2011-08-01", 5.52),
      cash("2012-08-01", 5.46),
      cash("2013-08-01", 4.63),
    ];
    expect(buildDividend(rows, []).consecutiveYears).toBe(4);
  });

  it("同一年多次配息（季配）只算一年", () => {
    const rows = [
      cash("2025-03-18", 4.5),
      cash("2025-06-12", 4.5),
      cash("2025-09-16", 4.5),
      cash("2026-03-18", 5.0),
    ];
    expect(buildDividend(rows, []).consecutiveYears).toBe(2);
  });

  it("同一年多次配息時，最近年度的現金股利是該年總和", () => {
    const rows = [cash("2026-03-18", 2.5), cash("2026-06-12", 3.0)];
    expect(buildDividend(rows, []).latestCash).toBeCloseTo(5.5, 6);
  });

  it("配息為零的年度視為中斷 —— 那一年並沒有配息", () => {
    const rows = [cash("2024-08-01", 3), cash("2025-08-01", 0), cash("2026-08-01", 4)];
    expect(buildDividend(rows, []).consecutiveYears).toBe(1);
  });

  it("標出資料涵蓋起點 —— 文案只能寫「N 年起連續」，不能宣稱完整歷史", () => {
    const rows = [cash("2005-08-01", 4.7), cash("2006-08-01", 4.3)];
    expect(buildDividend(rows, []).coverageFrom).toBe("2005");
  });

  it("近五個有配息年度取平均，不含中斷年", () => {
    const rows = [
      cash("2020-08-01", 1),
      cash("2021-08-01", 2),
      cash("2022-08-01", 3),
      cash("2023-08-01", 4),
      cash("2024-08-01", 5),
      cash("2025-08-01", 6),
    ];
    // 取最後五個有配息年度：2..6，平均 4
    expect(buildDividend(rows, []).avgCash5y).toBeCloseTo(4, 6);
  });

  it("填息以除息後的最高價是否回到除息前價位判定", () => {
    const results: DividendResultRow[] = [
      { date: "2025-03-18", before_price: 970, after_price: 965.49, max_price: 1060 },
      { date: "2025-06-12", before_price: 1065, after_price: 1060.49, max_price: 1000 },
    ];
    const d = buildDividend([], results);
    expect(d.filledTotal).toBe(2);
    expect(d.filled).toBe(1); // 1060 ≥ 970 填息；1000 < 1065 未填
  });

  it("缺價位的除息紀錄不計入填息統計，不當成失敗", () => {
    const results: DividendResultRow[] = [
      { date: "2025-03-18", before_price: null, after_price: null, max_price: null },
    ];
    expect(buildDividend([], results).filledTotal).toBe(0);
  });

  it("空輸入不崩潰", () => {
    const d = buildDividend([], []);
    expect(d.consecutiveYears).toBe(0);
    expect(d.latestCash).toBeNull();
    expect(d.coverageFrom).toBeNull();
    expect(d.avgCash5y).toBeNull();
  });

  it("只有股票股利沒有現金股利時不算連續配息年", () => {
    const rows: DividendRow[] = [
      { date: "2026-08-01", CashEarningsDistribution: 0, StockEarningsDistribution: 2 },
    ];
    expect(buildDividend(rows, []).consecutiveYears).toBe(0);
  });
});
