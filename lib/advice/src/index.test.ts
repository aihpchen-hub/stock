import { describe, expect, it } from "vitest";

import { deriveAdvice, type AdviceInput } from "./index";

/** 站上均線、現價落在區間內的中性起點，各測試只覆寫需要的欄位 */
function input(over: Partial<AdviceInput> = {}): AdviceInput {
  return { currentPrice: 100, entryLow: 96, entryHigh: 100, stopLoss: 90, ...over };
}

describe("deriveAdvice", () => {
  it("現價落在進場區間內 → 可進場", () => {
    expect(deriveAdvice(input())).toEqual({ action: "can_enter", planKind: "immediate" });
  });

  it("缺任一價位 → 資料不足，且不輸出計畫", () => {
    for (const missing of ["currentPrice", "entryLow", "entryHigh", "stopLoss"] as const) {
      expect(deriveAdvice(input({ [missing]: null }))).toEqual({
        action: "insufficient_data",
        planKind: "none",
      });
    }
  });

  // ── 以下三個案例直接對應使用者回報的缺陷 ──────────────────────────────

  it("跌破雙均線且現價低於停損 → 不建議進場，且不輸出任何計畫", () => {
    // 使用者回報的組合：進場區被設在月線之上（高於現價 80），
    // 停損由該假設進場價往下推，結果 85 仍高於現價。
    expect(deriveAdvice(input({ currentPrice: 80, entryLow: 95, entryHigh: 96, stopLoss: 85 }))).toEqual({
      action: "stop_breached",
      planKind: "none",
    });
  });

  it("跌破雙均線但停損未破 → 等待突破，且三個價位順序一致", () => {
    const i = input({ currentPrice: 92, entryLow: 95, entryHigh: 96, stopLoss: 85 });
    expect(deriveAdvice(i)).toEqual({ action: "wait_breakout", planKind: "conditional" });

    // 這組斷言證明排序正確：停損 < 現價 < 進場下緣，語意上完全一致 ——
    // 「現在 92，等站回 95 才進場，屆時停損掛在 85」。
    // 若把「區間在現價之上」的判斷排到停損檢查之前，上一個測試的案例
    // 會誤落到這一格，而那正是畫面上出現矛盾數字的原因。
    expect(i.stopLoss!).toBeLessThan(i.currentPrice!);
    expect(i.currentPrice!).toBeLessThan(i.entryLow!);
  });

  it("進場區間在現價之下 → 等待回檔", () => {
    expect(
      deriveAdvice(input({ currentPrice: 110, entryLow: 100, entryHigh: 105, stopLoss: 90 })),
    ).toEqual({ action: "wait_pullback", planKind: "pullback" });
  });

  it("現價恰等於停損視為已跌破", () => {
    expect(deriveAdvice(input({ currentPrice: 90, stopLoss: 90 })).action).toBe("stop_breached");
  });

  it("planKind 為 none 時代表畫面不該顯示任何價位", () => {
    for (const i of [
      input({ currentPrice: null }),
      input({ currentPrice: 80, entryLow: 95, entryHigh: 96, stopLoss: 85 }),
    ]) {
      expect(deriveAdvice(i).planKind).toBe("none");
    }
  });
});
