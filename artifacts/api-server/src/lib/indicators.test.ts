import { describe, expect, it } from "vitest";

import fixtures from "./__fixtures__/prices.json" with { type: "json" };
import {
  calcATR,
  calcAvgVolume,
  calcMA,
  calcReturn,
  calcSwing,
  calcTrailingStop,
  calcEMA,
  calcKD,
  calcMACD,
  calcMASlope,
  calcVolumeProfile,
  buildPriceSeries,
  detectCross,
  emaSeries,
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

// ─── 第二階段新增指標 ───────────────────────────────────────────────────────
// 以下的黃金值由一份「絕對索引 + NaN 補位」的獨立參考實作算出，
// 刻意與正式碼的序列位移寫法結構不同 —— MACD 兩條 EMA 起點不同、
// 必須對齊，那正是最容易寫錯又不會被自我一致的測試抓到的地方。

describe("emaSeries", () => {
  it("以前 period 根的簡單平均為種子", () => {
    const s = emaSeries([1, 2, 3, 4], 2)!;
    expect(s[0]).toBe(1.5); // (1+2)/2
  });

  it("序列長度為 資料長度 − period + 1", () => {
    expect(emaSeries(Array(69).fill(10), 26)!.length).toBe(44);
  });

  it("資料不足 period 時回傳 null", () => {
    expect(emaSeries([1, 2], 5)).toBeNull();
  });

  it("常數序列的 EMA 恆等於該常數", () => {
    expect(calcEMA(Array(50).fill(7), 12)).toBeCloseTo(7, 10);
  });
});

describe("detectCross", () => {
  it("快線由下穿上為黃金交叉", () => {
    expect(detectCross([1, 2, 3], [2, 2, 2])).toBe("golden");
  });

  it("快線由上穿下為死亡交叉", () => {
    expect(detectCross([3, 2, 1], [2, 2, 2])).toBe("dead");
  });

  it("交叉發生在 within 之外時不回報 —— 交叉是事件不是狀態", () => {
    // 第 1 根穿上去之後一路在上，最近 3 根內沒有交叉
    const fast = [1, 3, 4, 5, 6, 7];
    const slow = [2, 2, 2, 2, 2, 2];
    expect(detectCross(fast, slow, 3)).toBeNull();
    expect(detectCross(fast, slow, 6)).toBe("golden");
  });

  it("兩線長度不同時以尾端對齊", () => {
    expect(detectCross([9, 9, 1, 2, 3], [2, 2, 2])).toBe("golden");
  });
});

describe("calcMACD", () => {
  it("3017 的 DIF/DEA 與獨立參考實作一致", () => {
    const m = calcMACD(p3017.map((r) => r.close))!;
    expect(m.dif).toBeCloseTo(-62.0368, 3);
    expect(m.dea).toBeCloseTo(-59.0505, 3);
    expect(m.osc).toBeCloseTo(-2.9864, 3);
    expect(m.cross).toBe("dead");
  });

  it("8111 的 DIF/DEA 與獨立參考實作一致", () => {
    const m = calcMACD(p8111.map((r) => r.close))!;
    expect(m.dif).toBeCloseTo(1.1936, 3);
    expect(m.dea).toBeCloseTo(-0.8551, 3);
    expect(m.cross).toBeNull(); // 已在上方多時，最近 3 根內沒有交叉
  });

  it("osc 恆等於 dif − dea", () => {
    for (const rows of [p3017, p8111]) {
      const m = calcMACD(rows.map((r) => r.close))!;
      expect(m.osc).toBeCloseTo(m.dif - m.dea, 10);
    }
  });

  it("不足以算出第一個 DEA 時回傳 null", () => {
    expect(calcMACD(Array(33).fill(100))).toBeNull();
    expect(calcMACD(Array(34).fill(100))).not.toBeNull();
  });
});

describe("calcKD", () => {
  it("3017 的 K/D 與獨立參考實作一致", () => {
    const kd = calcKD(p3017)!;
    expect(kd.k).toBeCloseTo(46.1845, 3);
    expect(kd.d).toBeCloseTo(54.2336, 3);
    expect(kd.cross).toBe("dead");
  });

  it("8111 的 K/D 與獨立參考實作一致", () => {
    const kd = calcKD(p8111)!;
    expect(kd.k).toBeCloseTo(75.6826, 3);
    expect(kd.d).toBeCloseTo(70.471, 3);
  });

  it("K 與 D 恆落在 0~100", () => {
    for (const rows of [p3017, p8111]) {
      const kd = calcKD(rows)!;
      expect(kd.k).toBeGreaterThanOrEqual(0);
      expect(kd.k).toBeLessThanOrEqual(100);
      expect(kd.d).toBeGreaterThanOrEqual(0);
      expect(kd.d).toBeLessThanOrEqual(100);
    }
  });

  it("整段一價到底時 RSV 取 50 而非除以零", () => {
    const flat = Array.from({ length: 20 }, () => bar(50, 50, 50));
    const kd = calcKD(flat)!;
    expect(Number.isFinite(kd.k)).toBe(true);
    expect(kd.k).toBeCloseTo(50, 6);
  });

  it("不足 period 根時回傳 null", () => {
    expect(calcKD(Array.from({ length: 8 }, () => bar(10, 11, 9)))).toBeNull();
  });
});

describe("calcMASlope", () => {
  it("3017 的 MA20 斜率與獨立參考實作一致", () => {
    expect(calcMASlope(p3017.map((r) => r.close), 20)).toBeCloseTo(-1.1744, 3);
  });

  it("8111 的 MA20 斜率與獨立參考實作一致", () => {
    expect(calcMASlope(p8111.map((r) => r.close), 20)).toBeCloseTo(4.08, 3);
  });

  it("持平序列斜率為 0", () => {
    expect(calcMASlope(Array(40).fill(100), 20)).toBe(0);
  });

  it("用百分比，使不同價位的股票可用同一個門檻", () => {
    const cheap = [...Array(20).fill(10), ...Array(5).fill(11)];
    const rich = [...Array(20).fill(1000), ...Array(5).fill(1100)];
    expect(calcMASlope(cheap, 20)).toBeCloseTo(calcMASlope(rich, 20)!, 10);
  });

  it("資料不足 period + lookback 時回傳 null", () => {
    expect(calcMASlope(Array(24).fill(100), 20, 5)).toBeNull();
  });
});

describe("calcVolumeProfile", () => {
  it("8111 最新量為 20 日均量的 3.97 倍 → 爆量", () => {
    const v = calcVolumeProfile(p8111)!;
    expect(v.latest).toBe(27_496_974);
    expect(v.avg20).toBeCloseTo(6_927_670.85, 1);
    expect(v.ratio).toBeCloseTo(3.9692, 3);
    expect(v.kind).toBe("surge");
  });

  it("3017 為 1.49 倍 → 量增", () => {
    const v = calcVolumeProfile(p3017)!;
    expect(v.ratio).toBeCloseTo(1.487, 3);
    expect(v.kind).toBe("expanding");
  });

  it("分級門檻落在 2 / 1.3 / 0.7", () => {
    const withRatio = (ratio: number) => {
      const rows = Array.from({ length: 20 }, () => bar(10, 11, 9, 1000));
      rows.push(bar(10, 11, 9, Math.round(1000 * ratio)));
      return calcVolumeProfile(rows)!.kind;
    };
    // 均量含最新一根，故實際比值略低於傳入值；取明確落在區間內的點測試
    expect(withRatio(5)).toBe("surge");
    expect(withRatio(1.6)).toBe("expanding");
    expect(withRatio(1)).toBe("normal");
    expect(withRatio(0.3)).toBe("shrinking");
  });

  it("沒有任何有效成交量時回傳 null", () => {
    expect(calcVolumeProfile([bar(10, 11, 9, 0)])).toBeNull();
  });
});

describe("calcReturn", () => {
  it("回傳百分比而非小數 —— 與畫面上其他百分比欄位一致", () => {
    expect(calcReturn([100, 101, 102, 103, 104, 110], 5)).toBeCloseTo(10, 6);
  });

  it("下跌回負值", () => {
    expect(calcReturn([100, 99, 98, 97, 96, 90], 5)).toBeCloseTo(-10, 6);
  });

  it("只看頭尾兩根，中間的路徑不影響結果", () => {
    const straight = calcReturn([100, 105, 110], 2);
    const volatile = calcReturn([100, 200, 110], 2);
    expect(straight).toBeCloseTo(volatile!, 6);
  });

  it("資料不足 days+1 根時回 null，不用短一截的區間硬湊", () => {
    expect(calcReturn([100, 110], 5)).toBeNull();
    expect(calcReturn([], 1)).toBeNull();
  });

  it("剛好 days+1 根就算得出來", () => {
    expect(calcReturn([100, 110], 1)).toBeCloseTo(10, 6);
  });

  it("起始價為零或負數時回 null，不產生 Infinity", () => {
    expect(calcReturn([0, 110], 1)).toBeNull();
    expect(calcReturn([-5, 110], 1)).toBeNull();
  });

  it("days 非正數時回 null", () => {
    expect(calcReturn([100, 110], 0)).toBeNull();
    expect(calcReturn([100, 110], -3)).toBeNull();
  });
});

describe("calcATR 排除除權息跳空", () => {
  /** 指定日期的 bar，方便標出除息日 */
  function dated(date: string, close: number, max: number, min: number): PriceRow {
    return { date, close, max, min, Trading_Volume: 1_000_000 };
  }

  // 一檔 100 元、殖利率 7% 的股票在 2026-07-15 除息。
  // 平時日振幅約 2 元，除息當天開低 7 元。
  const rows: PriceRow[] = [
    dated("2026-07-14", 100, 101, 99),
    dated("2026-07-15", 93, 94, 92),
  ];

  it("未標示除息日時，跳空被當成真實風險（現況）", () => {
    // TR = max(94-92, |94-100|, |92-100|) = 8
    expect(calcATR(rows, 1)).toBeCloseTo(8, 5);
  });

  it("標示除息日後只取當日高低差，配息不算波動", () => {
    // 股利離開股價不是風險。把它算進 ATR 會讓停損距離憑空拉寬約 18%、
    // 建議張數少約 15%，而公司基本面完全沒變。
    expect(calcATR(rows, 1, new Set(["2026-07-15"]))).toBeCloseTo(2, 5);
  });

  it("除息日當天真的大跌時，日內振幅仍然算數", () => {
    // 除息 7 元，但當天還從 94 殺到 88 —— 那 6 元是真的波動
    const crash = [dated("2026-07-14", 100, 101, 99), dated("2026-07-15", 88, 94, 88)];
    expect(calcATR(crash, 1, new Set(["2026-07-15"]))).toBeCloseTo(6, 5);
  });

  it("非除息日不受影響", () => {
    expect(calcATR(rows, 1, new Set(["2026-07-14"]))).toBeCloseTo(8, 5);
    expect(calcATR(rows, 1, new Set())).toBeCloseTo(8, 5);
  });
});

describe("buildPriceSeries", () => {
  function dated(date: string, close: number): PriceRow {
    return { date, close, max: close, min: close, Trading_Volume: 1_000_000 };
  }

  it("取最後 N 根的收盤價，由舊到新", () => {
    const rows = [
      dated("2026-01-02", 10),
      dated("2026-01-03", 11),
      dated("2026-01-06", 12),
      dated("2026-01-07", 13),
    ];
    expect(buildPriceSeries(rows, 3)).toEqual({ from: "2026-01-03", closes: [11, 12, 13] });
  });

  it("資料比要求的少時就給全部，不補值", () => {
    const rows = [dated("2026-01-02", 10), dated("2026-01-03", 11)];
    expect(buildPriceSeries(rows, 60)).toEqual({ from: "2026-01-02", closes: [10, 11] });
  });

  it("不足兩根時回 null —— 一個點構不成走勢", () => {
    expect(buildPriceSeries([dated("2026-01-02", 10)], 60)).toBeNull();
    expect(buildPriceSeries([], 60)).toBeNull();
  });

  it("略過收盤價無效的列，日期跟著對齊", () => {
    const rows = [
      dated("2026-01-02", 10),
      { date: "2026-01-03", close: Number.NaN, max: 1, min: 1, Trading_Volume: 0 },
      dated("2026-01-06", 12),
    ];
    expect(buildPriceSeries(rows, 60)).toEqual({ from: "2026-01-02", closes: [10, 12] });
  });

  it("真實資料：8111 取 60 根", () => {
    const s = buildPriceSeries(p8111, 60)!;
    expect(s.closes).toHaveLength(60);
    expect(s.closes[s.closes.length - 1]).toBe(p8111[p8111.length - 1]!.close);
  });
});
