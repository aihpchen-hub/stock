import { describe, expect, it } from "vitest";

import { evaluateOutcome, tallyOutcomes, type Bar } from "./outcome";

/** 計畫：回檔到 98~100 進場，停損 90、停利 115 */
const plan = { entryLow: 98, entryHigh: 100, stopLoss: 90, takeProfit: 115 };

function bar(date: string, min: number, max: number, close = (min + max) / 2): Bar {
  return { date, min, max, close };
}

describe("evaluateOutcome", () => {
  it("先觸及停利判為達標", () => {
    const r = evaluateOutcome(
      [bar("2026-01-02", 97, 101), bar("2026-01-03", 100, 108), bar("2026-01-06", 110, 116)],
      plan,
    );
    expect(r.kind).toBe("target");
    expect(r.entryDate).toBe("2026-01-02");
    expect(r.exitDate).toBe("2026-01-06");
    expect(r.barsHeld).toBe(2);
  });

  it("先觸及停損判為停損", () => {
    const r = evaluateOutcome(
      [bar("2026-01-02", 97, 101), bar("2026-01-03", 94, 99), bar("2026-01-06", 88, 95)],
      plan,
    );
    expect(r.kind).toBe("stop");
    expect(r.exitDate).toBe("2026-01-06");
  });

  it("同一根同時觸及兩者時回 ambiguous —— 日線無法判定盤中先後", () => {
    const r = evaluateOutcome([bar("2026-01-02", 97, 101), bar("2026-01-03", 89, 116)], plan);
    expect(r.kind).toBe("ambiguous");
    expect(r.exitDate).toBe("2026-01-03");
  });

  it("兩者都未觸及時為仍持有", () => {
    const r = evaluateOutcome(
      [bar("2026-01-02", 97, 101), bar("2026-01-03", 95, 105), bar("2026-01-06", 99, 110)],
      plan,
    );
    expect(r.kind).toBe("open");
    expect(r.exitDate).toBeNull();
    expect(r.barsHeld).toBe(2);
  });

  it("價格從未進入進場區間時為未進場，不算成停損", () => {
    // 一路上漲，從未回到 100 以下
    const r = evaluateOutcome([bar("2026-01-02", 105, 110), bar("2026-01-03", 112, 120)], plan);
    expect(r.kind).toBe("no_entry");
    expect(r.entryDate).toBeNull();
  });

  it("直接跌破停損但未經進場區時仍為未進場", () => {
    // 跳空跌到 85，從未落在 98~100
    const r = evaluateOutcome([bar("2026-01-02", 80, 85)], plan);
    expect(r.kind).toBe("no_entry");
  });

  it("進場當日不判定出場 —— 同一根碰到進場區又碰到停損時無法得知順序", () => {
    const r = evaluateOutcome([bar("2026-01-02", 89, 101)], plan);
    expect(r.entryDate).toBe("2026-01-02");
    expect(r.kind).toBe("open"); // 不猜成停損
  });

  it("記錄進場後的最大有利與不利波動", () => {
    const r = evaluateOutcome(
      [bar("2026-01-02", 98, 100), bar("2026-01-03", 93, 112), bar("2026-01-06", 100, 116)],
      plan,
    );
    // 進場中值 99，最高 116、最低 93
    expect(r.maxFavorablePct).toBeCloseTo(((116 - 99) / 99) * 100, 4);
    expect(r.maxAdversePct).toBeCloseTo(((93 - 99) / 99) * 100, 4);
  });

  it("以進場後的第一次觸及為準，不看後續反轉", () => {
    // 先碰停損，之後才漲過停利 —— 結果必須是停損
    const r = evaluateOutcome(
      [bar("2026-01-02", 98, 100), bar("2026-01-03", 88, 95), bar("2026-01-06", 110, 120)],
      plan,
    );
    expect(r.kind).toBe("stop");
  });

  it("空資料或壞資料回 unknown，不編造結果", () => {
    expect(evaluateOutcome([], plan).kind).toBe("unknown");
    expect(evaluateOutcome([{ date: "x", min: NaN, max: NaN, close: 1 }], plan).kind).toBe("unknown");
    expect(evaluateOutcome([bar("2026-01-02", 98, 100)], { ...plan, takeProfit: 80 }).kind).toBe(
      "unknown",
    );
  });

  it("忽略高低倒置的壞 K 線", () => {
    const r = evaluateOutcome(
      [{ date: "bad", min: 200, max: 100, close: 150 }, bar("2026-01-02", 98, 100), bar("2026-01-03", 110, 116)],
      plan,
    );
    expect(r.entryDate).toBe("2026-01-02");
    expect(r.kind).toBe("target");
  });
});

describe("tallyOutcomes", () => {
  it("命中率分母只算已分出勝負的筆數", () => {
    const t = tallyOutcomes([
      { kind: "target" },
      { kind: "target" },
      { kind: "target" },
      { kind: "stop" },
      { kind: "open" },
      { kind: "open" },
      { kind: "no_entry" },
      { kind: "ambiguous" },
    ]);
    expect(t.decided).toBe(4);
    expect(t.targetRate).toBe(75); // 3/4，未把仍持有與未進場算進分母
    expect(t.open).toBe(2);
    expect(t.noEntry).toBe(1);
    expect(t.ambiguous).toBe(1);
  });

  it("尚無已結案的筆數時命中率為 null，不顯示 0% 假裝有結論", () => {
    const t = tallyOutcomes([{ kind: "open" }, { kind: "no_entry" }]);
    expect(t.targetRate).toBeNull();
    expect(t.decided).toBe(0);
  });

  it("空輸入不崩潰", () => {
    expect(tallyOutcomes([]).targetRate).toBeNull();
  });

  it("ambiguous 不計入任何一邊", () => {
    const t = tallyOutcomes([{ kind: "target" }, { kind: "ambiguous" }]);
    expect(t.decided).toBe(1);
    expect(t.targetRate).toBe(100);
  });
});
