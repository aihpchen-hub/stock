import { describe, expect, it } from "vitest";

import { buildMarketContext, buildRelativeStrength, buildReturns } from "./market";
import type { PriceRow } from "./indicators";

/** 產生 n 根等差日線，收盤自 start 起每根 +step */
function rows(n: number, start = 100, step = 1): PriceRow[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start + i * step;
    return {
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      open: close,
      max: close,
      min: close,
      close,
      Trading_Volume: 1000,
    } satisfies PriceRow;
  });
}

describe("buildReturns", () => {
  it("三個天期各自獨立計算", () => {
    const closes = rows(80).map((r) => r.close);
    const r = buildReturns(closes);
    expect(r.d5).not.toBeNull();
    expect(r.d20).not.toBeNull();
    expect(r.d60).not.toBeNull();
    // 等差上漲，長天期的報酬必定大於短天期
    expect(r.d60!).toBeGreaterThan(r.d20!);
    expect(r.d20!).toBeGreaterThan(r.d5!);
  });

  it("資料只夠短天期時，長天期為 null 而非硬湊", () => {
    const closes = rows(10).map((r) => r.close);
    const r = buildReturns(closes);
    expect(r.d5).not.toBeNull();
    expect(r.d20).toBeNull();
    expect(r.d60).toBeNull();
  });
});

describe("buildMarketContext", () => {
  it("持續上漲時站上雙均線", () => {
    expect(buildMarketContext(rows(80)).maSignal).toBe("above_both");
  });

  it("持續下跌時跌破雙均線 —— 這是系統性風險提示的觸發條件", () => {
    expect(buildMarketContext(rows(80, 200, -1)).maSignal).toBe("below_both");
  });

  it("資料不足以算出 MA60 時明講資料不足，不退回二態", () => {
    expect(buildMarketContext(rows(30)).maSignal).toBe("insufficient_data");
  });

  it("空輸入不崩潰，全部為 null", () => {
    const m = buildMarketContext([]);
    expect(m.maSignal).toBe("insufficient_data");
    expect(m.return20d).toBeNull();
    expect(m.asOf).toBeNull();
  });

  it("asOf 取最後一根的日期 —— 大盤與個股的資料日期未必同步", () => {
    const data = rows(80);
    expect(buildMarketContext(data).asOf).toBe(data[79]!.date);
  });
});

describe("buildRelativeStrength", () => {
  const market = {
    return5d: 3,
    return20d: 10,
    return60d: 20,
    maSignal: "above_both" as const,
    asOf: "2026-08-03",
  };

  it("相對強弱是個股報酬減大盤報酬，單位是百分點", () => {
    const rs = buildRelativeStrength({ d5: 5, d20: 8, d60: 20 }, market);
    expect(rs.d5).toBeCloseTo(2, 6);
    // 個股漲 8% 而大盤漲 10% —— 絕對值是正的，相對大盤卻是輸的，
    // 而這正是只看個股均線判不出來的那件事
    expect(rs.d20).toBeCloseTo(-2, 6);
    expect(rs.d60).toBeCloseTo(0, 6);
  });

  it("任一邊缺值時該天期為 null，不當成零", () => {
    const rs = buildRelativeStrength({ d5: 5, d20: null, d60: 1 }, { ...market, return60d: null });
    expect(rs.d5).toBeCloseTo(2, 6);
    expect(rs.d20).toBeNull();
    expect(rs.d60).toBeNull();
  });
});
