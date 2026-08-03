import { describe, expect, it } from "vitest";

import { buildNarrative, type NarrativeInput } from "./narrative";
import type { Signal } from "./signals";

function sig(key: string, label: string, direction: Signal["direction"]): Signal {
  return { key, label, direction, detail: "x" };
}

function input(over: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    name: "台積電",
    code: "2330",
    trend: "uptrend",
    action: "can_enter",
    planKind: "immediate",
    signals: [],
    foreignNet5d: null,
    foreignTrend: null,
    entryLow: null,
    entryHigh: null,
    stopLoss: null,
    riskRewardRatio: null,
    period: "3m",
    ...over,
  };
}

describe("buildNarrative", () => {
  it("只有趨勢與建議時仍組得出第一句", () => {
    expect(buildNarrative(input())).toBe("台積電目前處於上升趨勢，現價落在建議進場區內。");
  });

  it("沒有名稱時退回代號，不留空白", () => {
    expect(buildNarrative(input({ name: null }))?.startsWith("2330目前")).toBe(true);
  });

  it("看多最多 3 條、看空最多 2 條", () => {
    const s = buildNarrative(
      input({
        signals: [
          sig("a", "多1", "bullish"),
          sig("b", "多2", "bullish"),
          sig("c", "多3", "bullish"),
          sig("d", "多4", "bullish"),
          sig("e", "空1", "bearish"),
          sig("f", "空2", "bearish"),
          sig("g", "空3", "bearish"),
        ],
      }),
    )!;
    expect(s).toContain("看多訊號有多1、多2、多3");
    expect(s).not.toContain("多4");
    expect(s).toContain("看空訊號有空1、空2");
    expect(s).not.toContain("空3");
  });

  it("中性訊號不入句 —— 放進看多或看空任一邊都是在陳述資料支持不了的方向", () => {
    const s = buildNarrative(input({ signals: [sig("v", "爆量", "neutral")] }))!;
    expect(s).not.toContain("爆量");
    expect(s).not.toContain("看多訊號");
  });

  it("只有看空訊號時不會冒出空的看多子句", () => {
    const s = buildNarrative(input({ signals: [sig("e", "空1", "bearish")] }))!;
    expect(s).toContain("看空訊號有空1。");
    expect(s).not.toContain("看多訊號");
  });

  it("籌碼句以張為單位，方向由正負決定", () => {
    expect(
      buildNarrative(input({ foreignNet5d: 1_234_000, foreignTrend: "accumulating" })),
    ).toContain("外資近 5 日買超 1,234 張，買盤持續加強");
    expect(
      buildNarrative(input({ foreignNet5d: -1_234_000, foreignTrend: "distributing" })),
    ).toContain("外資近 5 日賣超 1,234 張，賣壓持續加強");
  });

  it("籌碼欄位缺一個就整句略過，不編造", () => {
    expect(buildNarrative(input({ foreignNet5d: 1_000, foreignTrend: null }))).not.toContain("籌碼面");
    expect(buildNarrative(input({ foreignNet5d: null, foreignTrend: "accumulating" }))).not.toContain("籌碼面");
  });

  it("已成立的計畫用「建議進場區」陳述", () => {
    const s = buildNarrative(
      input({ entryLow: 96, entryHigh: 100, stopLoss: 90, riskRewardRatio: 1.5 }),
    )!;
    expect(s).toContain("建議進場區 96~100，停損 90（風報比 1.50），適合波段（約 3 個月）操作。");
  });

  it("尚未成立的計畫不得說成「建議進場區」—— 那正是第一階段修掉的缺陷", () => {
    const s = buildNarrative(
      input({
        planKind: "conditional",
        action: "wait_breakout",
        entryLow: 105,
        entryHigh: 110,
        stopLoss: 98,
      }),
    )!;
    expect(s).not.toContain("建議進場區");
    expect(s).toContain("站回 105 之上這份計畫才成立");
  });

  it("planKind 為 none 時整段價位略過 —— 不把畫面剛抑制掉的矛盾用文字重講一次", () => {
    const s = buildNarrative(
      input({
        planKind: "none",
        action: "stop_breached",
        entryLow: 96,
        entryHigh: 100,
        stopLoss: 90,
      }),
    )!;
    expect(s).not.toContain("96");
    expect(s).not.toContain("進場區");
    expect(s).toContain("現價已跌破停損");
  });

  it("價位缺一個就整句略過", () => {
    // 第一句的「現價落在建議進場區內」本來就含「進場區」，故斷言具體價位
    const s = buildNarrative(input({ entryLow: 96, entryHigh: 100, stopLoss: null }))!;
    expect(s).not.toContain("96");
    expect(s).not.toContain("適合");
  });

  it("缺風報比時不留空括號", () => {
    const s = buildNarrative(input({ entryLow: 96, entryHigh: 100, stopLoss: 90 }))!;
    expect(s).not.toContain("（）");
    expect(s).toContain("停損 90，適合");
  });

  it("策略敘述隨週期改變，認不得的週期退回波段", () => {
    const plan = { entryLow: 96, entryHigh: 100, stopLoss: 90 };
    expect(buildNarrative(input({ ...plan, period: "1m" }))).toContain("短線（約 1 個月）");
    expect(buildNarrative(input({ ...plan, period: "6m" }))).toContain("中長線（約 6 個月）");
    expect(buildNarrative(input({ ...plan, period: "99y" }))).toContain("波段（約 3 個月）");
    expect(buildNarrative(input({ ...plan, period: null }))).toContain("波段（約 3 個月）");
  });

  it("句子之間不留下破碎的標點", () => {
    const s = buildNarrative(
      input({
        signals: [sig("a", "多1", "bullish")],
        foreignNet5d: 5_000_000,
        foreignTrend: "accumulating",
        entryLow: 96,
        entryHigh: 100,
        stopLoss: 90,
        riskRewardRatio: 2,
      }),
    )!;
    expect(s).not.toMatch(/。。|；。|，。|、。/);
    expect(s.endsWith("。")).toBe(true);
  });
});
