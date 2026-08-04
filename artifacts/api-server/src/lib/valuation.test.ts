import { describe, expect, it } from "vitest";

import { buildBand, buildValuation, type PerRow } from "./valuation";

describe("buildBand", () => {
  it("百分位是「目前值高於歷史的幾成」—— 用來回答現在算貴還是便宜", () => {
    const b = buildBand([10, 20, 30, 40, 50]);
    expect(b.current).toBe(50);
    expect(b.percentile).toBe(100); // 4 個比它低 ÷ (5-1)
  });

  it("最低點時百分位為 0", () => {
    expect(buildBand([50, 40, 30, 20, 10]).percentile).toBe(0);
  });

  it("中間值落在中間", () => {
    expect(buildBand([10, 50, 30]).percentile).toBe(50); // 30 高於 1 個，÷2
  });

  it("回報區間端點與中位數 —— 只給百分位看不出貴多少", () => {
    const b = buildBand([10, 20, 30, 40, 50]);
    expect(b.low).toBe(10);
    expect(b.high).toBe(50);
    expect(b.median).toBe(30);
  });

  it("偶數筆時中位數取中間兩筆平均", () => {
    expect(buildBand([10, 20, 30, 40]).median).toBe(25);
  });

  it("濾掉 null 與非有限值 —— 虧損公司沒有本益比，那是缺值不是零", () => {
    const b = buildBand([10, null, 20, Number.NaN, Number.POSITIVE_INFINITY, 30]);
    expect(b.samples).toBe(3);
    expect(b.current).toBe(30);
  });

  it("負值也濾掉 —— 本益比為負代表虧損，放進區間會把百分位算歪", () => {
    expect(buildBand([-5, 10, 20]).samples).toBe(2);
  });

  it("完全沒有可用樣本時全部為 null，不以 0 假裝有結論", () => {
    const b = buildBand([]);
    expect(b.current).toBeNull();
    expect(b.percentile).toBeNull();
    expect(b.samples).toBe(0);
  });

  it("只有一筆樣本時百分位為 null —— 一個點構不成區間", () => {
    const b = buildBand([25]);
    expect(b.current).toBe(25);
    expect(b.percentile).toBeNull();
    expect(b.samples).toBe(1);
  });
});

describe("buildValuation", () => {
  const rows: PerRow[] = [
    { date: "2026-08-01", PER: 20, PBR: 3, dividend_yield: 2 },
    { date: "2026-08-02", PER: 25, PBR: 4, dividend_yield: 1.5 },
    { date: "2026-08-03", PER: 30, PBR: 5, dividend_yield: 1 },
  ];

  it("三個指標各自成帶，current 取最後一筆", () => {
    const v = buildValuation(rows);
    expect(v.per.current).toBe(30);
    expect(v.pbr.current).toBe(5);
    expect(v.dividendYield.current).toBe(1);
  });

  it("asOf 取最後一筆日期", () => {
    expect(buildValuation(rows).asOf).toBe("2026-08-03");
  });

  it("空輸入不崩潰", () => {
    const v = buildValuation([]);
    expect(v.asOf).toBeNull();
    expect(v.per.samples).toBe(0);
  });
});
