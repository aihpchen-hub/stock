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

  it("成立率的分子是真的進場的筆數，達標率看不出這件事", () => {
    // 40 筆從未觸發進場、6 筆達標、4 筆停損 —— 達標率 60% 講的是
    // 「成立的那 10 筆裡有幾筆達標」，而使用者手上有 50 筆紀錄。
    // 少了成立率，那 40 筆會在畫面上憑空消失。
    const results = [
      ...Array.from({ length: 40 }, () => ({ kind: "no_entry" as const })),
      ...Array.from({ length: 6 }, () => ({ kind: "target" as const })),
      ...Array.from({ length: 4 }, () => ({ kind: "stop" as const })),
    ];
    const t = tallyOutcomes(results);
    expect(t.targetRate).toBe(60);
    expect(t.entered).toBe(10);
    expect(t.entryRate).toBe(20);
  });

  it("仍持有與同日觸及兩者都算成立 —— 那些交易確實發生了", () => {
    const t = tallyOutcomes([{ kind: "open" }, { kind: "ambiguous" }, { kind: "no_entry" }]);
    expect(t.entered).toBe(2);
    expect(t.entryRate).toBeCloseTo(66.7, 1);
  });

  it("資料不足者不進成立率的分母 —— 與 ambiguous 不進達標率分母同一個原則", () => {
    const t = tallyOutcomes([{ kind: "target" }, { kind: "no_entry" }, { kind: "unknown" }]);
    // 分母是 1 筆成立 + 1 筆未進場 = 2，unknown 兩邊都不算
    expect(t.entryRate).toBe(50);
  });

  it("沒有任何可判定的筆數時成立率為 null，不以 0% 假裝有結論", () => {
    expect(tallyOutcomes([{ kind: "unknown" }]).entryRate).toBeNull();
    expect(tallyOutcomes([]).entryRate).toBeNull();
  });
});

describe("除息跳空不算停損", () => {
  // 計畫：98~100 進場，停損 90、停利 115（與上方同一組）
  // 2026-01-05 除息 8 元：除息前收 99、除息後參考價 91。
  const bars = [
    bar("2026-01-02", 97, 101),
    bar("2026-01-03", 97, 100),
    bar("2026-01-05", 89, 92), // 除息當天，最低 89 跌破停損 90
    bar("2026-01-06", 90, 93),
  ];
  const div = [{ date: "2026-01-05", drop: 8 }];

  it("未提供除息資料時被判成停損（現況）", () => {
    expect(evaluateOutcome(bars, plan).kind).toBe("stop");
  });

  it("提供除息資料後不再判成停損 —— 那不是虧損，是配息落袋", () => {
    // 除息季在 7~9 月，而達標率是這個產品用來校正那張未經回測機率表的
    // 唯一手段。把配息判成停損會系統性壓低它。
    const r = evaluateOutcome(bars, plan, div);
    expect(r.kind).toBe("open");
    expect(r.exitDate).toBeNull();
  });

  it("除息之外真的跌破停損時仍然判停損", () => {
    // 除息 8 元後又再跌到 80：還原後是 88，確實低於停損 90
    const crash = [...bars.slice(0, 3), bar("2026-01-06", 80, 84)];
    expect(evaluateOutcome(crash, plan, div).kind).toBe("stop");
  });

  it("除息後的停利門檻同步下移，不會因此永遠達不到", () => {
    // 除息 8 元後漲到 108：還原後是 116，已達停利 115
    const rally = [...bars.slice(0, 3), bar("2026-01-06", 105, 108)];
    expect(evaluateOutcome(rally, plan, div).kind).toBe("target");
  });

  it("進場之前的除息不影響判定", () => {
    const early = [{ date: "2026-01-01", drop: 8 }];
    expect(evaluateOutcome(bars, plan, early).kind).toBe("stop");
  });
});
