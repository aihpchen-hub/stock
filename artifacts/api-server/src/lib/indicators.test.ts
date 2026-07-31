import { describe, expect, it } from "vitest";

import fixtures from "./__fixtures__/prices.json" with { type: "json" };
import {
  calcATR,
  calcAvgVolume,
  calcMA,
  calcSwing,
  calcTrailingStop,
  type PriceRow,
} from "./indicators";

// 真實的 FinMind 日線資料（截至 2026-07-29），不是編出來的數字
const p8111 = fixtures["8111"] as PriceRow[];
const p3017 = fixtures["3017"] as PriceRow[];

function bar(close: number, max: number, min: number, volume = 1_000_000): PriceRow {
  return { date: "2026-01-01", close, max, min, Trading_Volume: volume };
}

describe("calcMA", () => {
  it("只取最後 N 筆求平均", () => {
    expect(calcMA([1, 2, 3, 10, 20, 30], 3)).toBe(20);
  });

  it("資料筆數不足回傳 null，不用少於 N 筆硬算", () => {
    expect(calcMA([1, 2], 5)).toBeNull();
  });

  it("剛好等於 N 筆時可計算", () => {
    expect(calcMA([2, 4, 6], 3)).toBe(4);
  });
});

describe("calcATR", () => {
  // 這兩個值先前以獨立腳本手算驗證過，作為黃金基準
  it("3017 的 ATR(14) 為 170.71", () => {
    expect(calcATR(p3017)).toBeCloseTo(170.71, 2);
  });

  it("8111 的 ATR(14) 為 4.63", () => {
    expect(calcATR(p8111)).toBeCloseTo(4.63, 2);
  });

  it("需要 period+1 筆才算得出來（要用到前一天收盤）", () => {
    const bars = Array.from({ length: 14 }, () => bar(100, 102, 98));
    expect(calcATR(bars, 14)).toBeNull();
    expect(calcATR([...bars, bar(100, 102, 98)], 14)).not.toBeNull();
  });

  it("把跳空缺口計入 True Range，而非只看當日高低差", () => {
    // 前一天收 100，隔天整段跳空到 120~125：高低差只有 5，但實際風險是 25
    const bars = [bar(100, 101, 99), bar(122, 125, 120)];
    expect(calcATR(bars, 1)).toBeCloseTo(25, 5);
  });

  it("純粹的當日高低差（無缺口）等於 high - low", () => {
    const bars = [bar(100, 100, 100), bar(100, 105, 95)];
    expect(calcATR(bars, 1)).toBeCloseTo(10, 5);
  });
});

describe("calcSwing", () => {
  it("回傳近 N 根的最高與最低", () => {
    const bars = [bar(10, 12, 8), bar(10, 20, 9), bar(10, 15, 3)];
    expect(calcSwing(bars, 3)).toEqual({ high: 20, low: 3 });
  });

  it("只看最後 N 根，較早的極值不算", () => {
    const bars = [bar(10, 999, 1), bar(10, 12, 8), bar(10, 13, 7)];
    expect(calcSwing(bars, 2)).toEqual({ high: 13, low: 7 });
  });

  it("空陣列回傳 null 而非 Infinity", () => {
    expect(calcSwing([], 20)).toEqual({ high: null, low: null });
  });
});

describe("calcAvgVolume", () => {
  it("平均近 N 日成交量", () => {
    const bars = [bar(10, 10, 10, 100), bar(10, 10, 10, 200), bar(10, 10, 10, 300)];
    expect(calcAvgVolume(bars, 3)).toBe(200);
  });

  it("忽略成交量為零的停牌日，不把平均拉低", () => {
    const bars = [bar(10, 10, 10, 0), bar(10, 10, 10, 100), bar(10, 10, 10, 300)];
    expect(calcAvgVolume(bars, 3)).toBe(200);
  });

  it("全部為零時回傳 null", () => {
    expect(calcAvgVolume([bar(10, 10, 10, 0)], 20)).toBeNull();
  });
});

describe("calcTrailingStop", () => {
  it("等於近期高點減 2.5 個 ATR", () => {
    expect(calcTrailingStop(100, 10)).toBe(75);
  });

  it("比初始停損（2 ATR）寬，才不會被正常回檔洗掉", () => {
    const atr = 10;
    const entry = 100;
    const initialStop = entry - 2 * atr; // 80
    // 高點與進場同價時，移動停損理應更低（更寬）
    expect(calcTrailingStop(entry, atr)).toBeLessThan(initialStop);
  });

  it("高點越高，移動停損跟著上移", () => {
    const low = calcTrailingStop(100, 10);
    const high = calcTrailingStop(130, 10);
    expect(high).toBeGreaterThan(low as number);
  });

  it("缺少高點或 ATR 時回傳 null", () => {
    expect(calcTrailingStop(null, 10)).toBeNull();
    expect(calcTrailingStop(100, null)).toBeNull();
    expect(calcTrailingStop(100, 0)).toBeNull();
  });
});

describe("移動停損的時間尺度", () => {
  it("未指定係數時等同 1（沿用原行為）", () => {
    expect(calcTrailingStop(100, 4)).toBe(calcTrailingStop(100, 4, 1));
    expect(calcTrailingStop(100, 4)).toBe(90); // 100 − 2.5×4
  });

  it("係數放大時掛得更遠", () => {
    expect(calcTrailingStop(100, 4, 1.41)).toBeCloseTo(100 - 2.5 * 4 * 1.41, 2);
    expect(calcTrailingStop(100, 4, 1.41)!).toBeLessThan(calcTrailingStop(100, 4)!);
  });

  it("移動停損永遠比初始停損寬 —— 長週期也不例外", () => {
    // 初始停損距離 2×ATR×係數，移動停損距離 2.5×ATR×係數，兩者共用係數
    for (const factor of [0.58, 1, 1.41]) {
      const atr = 5;
      const initialDistance = 2 * atr * factor;
      const trailingDistance = 100 - calcTrailingStop(100, atr, factor)!;
      expect(trailingDistance).toBeGreaterThan(initialDistance);
    }
  });
});

describe("移動停損不得高於部位高點", () => {
  it("永遠低於部位高點", () => {
    for (const factor of [0.58, 1, 1.41]) {
      expect(calcTrailingStop(100, 5, factor)!).toBeLessThan(100);
    }
  });

  it("以近20日高當部位高點會算出高於進場價的停損 —— 這是不能用它的原因", () => {
    // 3017 實例：近20日高 2790、進場區中值約 2382、ATR 170.7、1個月係數 0.577
    const swingHigh = 2790;
    const entryMid = 2381.86;
    const wrong = calcTrailingStop(swingHigh, 170.71, 0.5774)!;
    expect(wrong).toBeGreaterThan(entryMid); // 一進場就出場
    const right = calcTrailingStop(entryMid, 170.71, 0.5774)!;
    expect(right).toBeLessThan(entryMid);
  });
});
