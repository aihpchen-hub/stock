import { describe, expect, it } from "vitest";

import fixtures from "./__fixtures__/prices.json" with { type: "json" };
import type { Chips } from "./chips";
import {
  calcKD,
  calcMA,
  calcMACD,
  calcVolumeProfile,
  type PriceRow,
  type VolumeProfile,
} from "./indicators";
import { detectSignals, detectTrend, type SignalInput } from "./signals";

const p8111 = fixtures["8111"] as PriceRow[];
const p3017 = fixtures["3017"] as PriceRow[];

function bar(close: number, volume = 1_000_000): PriceRow {
  return { date: "2026-01-01", close, max: close, min: close, Trading_Volume: volume };
}

/** 只給要測的欄位，其餘一律關掉，讓每個測試只有一個變因 */
function input(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    closes: [],
    rows: [],
    ma20: null,
    ma60: null,
    macd: null,
    kd: null,
    volume: null,
    chips: null,
    revenueYoY: null,
    ...overrides,
  };
}

function chipsWith(foreign: number, trust = 0): Chips {
  const empty = { windows: { d1: null, d5: null, d10: null, d20: null }, trend: "neutral" as const };
  return {
    tradingDays: 20,
    foreign: { ...empty, streak: foreign },
    trust: { ...empty, streak: trust },
    dealer: { ...empty, streak: 0 },
  };
}

const keys = (i: SignalInput) => detectSignals(i).map((s) => s.key);

describe("均線排列", () => {
  it("MA5 > MA10 > MA20 > MA60 為多頭排列", () => {
    // 單調遞增 → 短均線必在長均線之上
    const closes = Array.from({ length: 70 }, (_, i) => 100 + i);
    expect(keys(input({ closes }))).toContain("ma_bull_stack");
  });

  it("單調遞減為空頭排列", () => {
    const closes = Array.from({ length: 70 }, (_, i) => 200 - i);
    expect(keys(input({ closes }))).toContain("ma_bear_stack");
  });

  it("不足 60 根時兩者都不出現，不用少於 60 根硬算", () => {
    const closes = Array.from({ length: 59 }, (_, i) => 100 + i);
    const k = keys(input({ closes }));
    expect(k).not.toContain("ma_bull_stack");
    expect(k).not.toContain("ma_bear_stack");
  });

  it("糾結時不給排列訊號", () => {
    const closes = Array.from({ length: 70 }, (_, i) => 100 + (i % 3));
    const k = keys(input({ closes }));
    expect(k).not.toContain("ma_bull_stack");
    expect(k).not.toContain("ma_bear_stack");
  });
});

describe("MACD 與 KD", () => {
  it("黃金交叉與死亡交叉各自產生訊號", () => {
    expect(keys(input({ macd: { dif: 1, dea: 0.5, osc: 0.5, cross: "golden" } }))).toContain("macd_golden");
    expect(keys(input({ macd: { dif: -1, dea: -0.5, osc: -0.5, cross: "dead" } }))).toContain("macd_dead");
  });

  it("沒有交叉時不產生 MACD 訊號 —— 交叉是事件不是狀態", () => {
    expect(keys(input({ macd: { dif: 5, dea: 1, osc: 4, cross: null } }))).toEqual([]);
  });

  it("KD 黃金交叉在 K ≥ 80 時不算數（高檔交叉參考價值低）", () => {
    expect(keys(input({ kd: { k: 79.9, d: 70, cross: "golden" } }))).toContain("kd_golden");
    expect(keys(input({ kd: { k: 80.1, d: 70, cross: "golden" } }))).not.toContain("kd_golden");
  });

  it("KD 死亡交叉在 K ≤ 20 時不算數", () => {
    expect(keys(input({ kd: { k: 20.1, d: 30, cross: "dead" } }))).toContain("kd_dead");
    expect(keys(input({ kd: { k: 19.9, d: 30, cross: "dead" } }))).not.toContain("kd_dead");
  });

  it("K > 80 為高檔鈍化，且與交叉訊號可並存", () => {
    const k = keys(input({ kd: { k: 85, d: 70, cross: "golden" } }));
    expect(k).toContain("kd_overbought");
    expect(k).not.toContain("kd_golden");
  });

  it("K 剛好 80 不算鈍化", () => {
    expect(keys(input({ kd: { k: 80, d: 70, cross: null } }))).toEqual([]);
  });
});

describe("法人連續買賣超", () => {
  it("連買 3 日達標、2 日不達標", () => {
    expect(keys(input({ chips: chipsWith(3) }))).toContain("foreign_streak");
    expect(keys(input({ chips: chipsWith(2) }))).not.toContain("foreign_streak");
  });

  it("連賣同樣達標 —— 否則籌碼訊號只會出現在偏多的一側", () => {
    const signals = detectSignals(input({ chips: chipsWith(-5) }));
    const s = signals.find((x) => x.key === "foreign_streak")!;
    expect(s.direction).toBe("bearish");
    expect(s.label).toBe("外資連賣 5 日");
  });

  it("外資與投信各自獨立判斷", () => {
    expect(keys(input({ chips: chipsWith(0, 4) }))).toEqual(["trust_streak"]);
  });
});

describe("量能", () => {
  const vol = (ratio: number, latest = 1_000_000): VolumeProfile => ({
    latest,
    avg5: null,
    avg20: latest / ratio,
    ratio,
    kind: ratio >= 2 ? "surge" : ratio >= 1.3 ? "expanding" : ratio >= 0.7 ? "normal" : "shrinking",
  });

  it("爆量與量縮都標為中性 —— 兩者本身都不指向任何一邊", () => {
    const surge = detectSignals(input({ closes: [], volume: vol(3) }));
    expect(surge[0]?.key).toBe("volume_surge");
    expect(surge[0]?.direction).toBe("neutral");
    const dry = detectSignals(input({ closes: [], volume: vol(0.5) }));
    expect(dry[0]?.direction).toBe("neutral");
  });

  it("量增突破需要「量增」與「收盤創新高」同時成立", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i); // 最後一根即新高
    expect(keys(input({ closes: rising, volume: vol(1.5) }))).toContain("volume_breakout");
    // 量不夠
    expect(keys(input({ closes: rising, volume: vol(1.1) }))).not.toContain("volume_breakout");
    // 價不夠：最後一根回落
    const pullback = [...rising.slice(0, 19), 105];
    expect(keys(input({ closes: pullback, volume: vol(1.5) }))).not.toContain("volume_breakout");
  });

  it("用收盤價而非盤中高點判定新高 —— 盤中觸及後收黑不算突破", () => {
    const closes = [...Array.from({ length: 19 }, (_, i) => 100 + i), 110];
    // 收盤 110 低於前高 118，即使當日盤中曾更高也不給突破
    expect(keys(input({ closes, volume: vol(2.5) }))).not.toContain("volume_breakout");
  });

  it("不足 20 根收盤價時不判定突破", () => {
    const closes = Array.from({ length: 19 }, (_, i) => 100 + i);
    expect(keys(input({ closes, volume: vol(1.5) }))).not.toContain("volume_breakout");
  });
});

describe("營收", () => {
  it("年增超過 30% 才算訊號", () => {
    expect(keys(input({ revenueYoY: 30.1 }))).toContain("revenue_growth");
    expect(keys(input({ revenueYoY: 30 }))).not.toContain("revenue_growth");
    expect(keys(input({ revenueYoY: -50 }))).toEqual([]);
  });
});

describe("detectSignals 的整體行為", () => {
  it("什麼都算不出來時回空陣列，不丟例外", () => {
    expect(detectSignals(input())).toEqual([]);
  });

  it("每一條訊號都帶可驗算的 detail", () => {
    const signals = detectSignals(
      input({
        closes: Array.from({ length: 70 }, (_, i) => 100 + i),
        macd: { dif: 1, dea: 0.5, osc: 0.5, cross: "golden" },
        kd: { k: 60, d: 50, cross: "golden" },
        chips: chipsWith(4),
        revenueYoY: 67.9,
      }),
    );
    expect(signals.length).toBeGreaterThan(3);
    for (const s of signals) {
      expect(s.detail.length).toBeGreaterThan(0);
      expect(["bullish", "bearish", "neutral"]).toContain(s.direction);
    }
  });

  it("以 8111 的真實資料算出的訊號可與指標值對照", () => {
    const closes = p8111.map((r) => r.close);
    const signals = detectSignals(
      input({
        closes,
        macd: calcMACD(closes),
        kd: calcKD(p8111),
        volume: calcVolumeProfile(p8111),
        revenueYoY: null,
      }),
    );
    // 8111 最新量為均量 3.97 倍 → 必有爆量
    expect(signals.map((s) => s.key)).toContain("volume_surge");
  });
});

describe("detectTrend", () => {
  const rising = Array.from({ length: 70 }, (_, i) => 100 + i);
  const falling = Array.from({ length: 70 }, (_, i) => 200 - i);

  it("均線多頭、斜率向上、收盤在月線之上 → 上升趨勢", () => {
    const r = detectTrend(rising, calcMA(rising, 20), calcMA(rising, 60));
    expect(r.trend).toBe("uptrend");
    expect(r.basis).toContain("斜率");
  });

  it("三者反向 → 下降趨勢", () => {
    expect(detectTrend(falling, calcMA(falling, 20), calcMA(falling, 60)).trend).toBe("downtrend");
  });

  it("只缺斜率一項就不算趨勢 —— 少了它剛跌破月線的股票會被判成上升", () => {
    // MA20 > MA60 且收盤 > MA20，但最近 5 日均線走平
    const flatTop = [...Array.from({ length: 50 }, (_, i) => 100 + i), ...Array(20).fill(150)];
    const r = detectTrend(flatTop, calcMA(flatTop, 20), calcMA(flatTop, 60));
    expect(r.trend).toBe("range");
  });

  it("資料不足時回 range 並說明原因，不假裝判斷得出來", () => {
    const r = detectTrend([100, 101], null, null);
    expect(r.trend).toBe("range");
    expect(r.basis).toContain("資料不足");
  });

  it("basis 寫出四個實際數值供驗算", () => {
    const r = detectTrend(rising, calcMA(rising, 20), calcMA(rising, 60));
    expect(r.basis).toContain("MA20");
    expect(r.basis).toContain("MA60");
    expect(r.basis).toContain("收盤");
  });
});

describe("3017 的真實資料", () => {
  it("下跌中的個股不會被判成上升趨勢", () => {
    const closes = p3017.map((r) => r.close);
    const r = detectTrend(closes, calcMA(closes, 20), calcMA(closes, 60));
    expect(r.trend).not.toBe("uptrend");
  });

  it("MACD 死亡交叉會出現在訊號清單中", () => {
    const closes = p3017.map((r) => r.close);
    expect(keys(input({ closes, macd: calcMACD(closes) }))).toContain("macd_dead");
  });
});

// bar 目前僅供未來擴充使用
void bar;
