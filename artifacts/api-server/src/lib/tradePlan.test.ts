import { describe, expect, it } from "vitest";

import {
  bullAtrMultiple,
  calcEV,
  calcScore,
  horizonFactor,
  scenarioProbabilities,
  type EVInput,
} from "./tradePlan";
import { tickSize } from "./ticks";

/** 站上雙均線、無法人動作的中性起點，各測試只覆寫需要的欄位 */
function input(over: Partial<EVInput> = {}): EVInput {
  return {
    revenueYoY: 0,
    maSignal: "above_both",
    currentPrice: 100,
    ma20: 95,
    ma60: 90,
    atr: 5,
    foreignNet20dShares: 0,
    trustNet20dShares: 0,
    ...over,
  };
}

describe("calcScore", () => {
  it("營收 YoY 分段加分", () => {
    const base = calcScore(input({ maSignal: "insufficient_data", revenueYoY: 0 }));
    expect(calcScore(input({ maSignal: "insufficient_data", revenueYoY: 70 })) - base).toBe(3);
    expect(calcScore(input({ maSignal: "insufficient_data", revenueYoY: 40 })) - base).toBe(2);
    expect(calcScore(input({ maSignal: "insufficient_data", revenueYoY: 15 })) - base).toBe(1);
  });

  it("營收衰退扣分", () => {
    expect(calcScore(input({ maSignal: "insufficient_data", revenueYoY: -30 }))).toBe(-2);
    expect(calcScore(input({ maSignal: "insufficient_data", revenueYoY: -5 }))).toBe(-1);
  });

  it("技術位置：站上雙均線 +2、僅站上月線 +1、跌破雙線 -2", () => {
    expect(calcScore(input({ maSignal: "above_both" }))).toBe(2);
    expect(calcScore(input({ maSignal: "above_ma20" }))).toBe(1);
    expect(calcScore(input({ maSignal: "below_both" }))).toBe(-2);
  });

  it("外資買賣超以張為級距（輸入為股數），20 日門檻為 1300 張", () => {
    // 1,300,001 股 = 1300.001 張，剛好超過門檻
    expect(calcScore(input({ maSignal: "insufficient_data", foreignNet20dShares: 1_300_001 }))).toBe(2);
    expect(calcScore(input({ maSignal: "insufficient_data", foreignNet20dShares: 1_300_000 }))).toBe(1);
    expect(calcScore(input({ maSignal: "insufficient_data", foreignNet20dShares: 1_000 }))).toBe(1);
    expect(calcScore(input({ maSignal: "insufficient_data", foreignNet20dShares: -1_300_001 }))).toBe(-2);
    expect(calcScore(input({ maSignal: "insufficient_data", foreignNet20dShares: -1_000 }))).toBe(-1);
  });

  it("投信只給正負 0.5 的微調，20 日門檻為 350 張", () => {
    expect(calcScore(input({ maSignal: "insufficient_data", trustNet20dShares: 350_001 }))).toBe(0.5);
    expect(calcScore(input({ maSignal: "insufficient_data", trustNet20dShares: 350_000 }))).toBe(0);
    expect(calcScore(input({ maSignal: "insufficient_data", trustNet20dShares: -350_001 }))).toBe(-0.5);
  });

  it("籌碼資料不足 20 個交易日時不計分，不用較短天數硬湊", () => {
    expect(
      calcScore(
        input({
          maSignal: "insufficient_data",
          foreignNet20dShares: null,
          trustNet20dShares: null,
        }),
      ),
    ).toBe(0);
  });

  it("籌碼趨勢只看力道強弱，不看方向", () => {
    const base = { maSignal: "insufficient_data" } as const;
    // 買盤加強、賣壓減輕、近期轉買 —— 資金流向都往買方傾斜
    for (const trend of ["accumulating", "easing", "reversing_up"] as const) {
      expect(calcScore(input({ ...base, foreignTrend: trend }))).toBe(0.5);
    }
    // 買盤退潮、賣壓加強、近期轉賣
    for (const trend of ["slowing", "distributing", "reversing_down"] as const) {
      expect(calcScore(input({ ...base, foreignTrend: trend }))).toBe(-0.5);
    }
    for (const trend of ["neutral", "insufficient_data"] as const) {
      expect(calcScore(input({ ...base, foreignTrend: trend }))).toBe(0);
    }
    expect(calcScore(input({ ...base, foreignTrend: null }))).toBe(0);
  });

  // 規格與舊註解都寫「-7.5 ~ 7.5」，但那是照著一個本來就寫錯的舊上下限推的。
  // 這個測試鎖住實際算術，讓下一個人不必再重算一次。
  it("總分範圍為 -7 ~ 8", () => {
    const best = calcScore(
      input({
        revenueYoY: 100,
        maSignal: "above_both",
        foreignNet20dShares: 9_000_000,
        trustNet20dShares: 9_000_000,
        foreignTrend: "accumulating",
      }),
    );
    const worst = calcScore(
      input({
        revenueYoY: -50,
        maSignal: "below_both",
        foreignNet20dShares: -9_000_000,
        trustNet20dShares: -9_000_000,
        foreignTrend: "distributing",
      }),
    );
    expect(best).toBe(8);
    expect(worst).toBe(-7);
  });
});

describe("scenarioProbabilities", () => {
  it("任何評分下三情境機率恆為 1", () => {
    for (const score of [10, 5, 4, 3, 2, 1, 0, -1, -2, -3, -7]) {
      const { pBull, pBase, pBear } = scenarioProbabilities(score);
      expect(pBull + pBase + pBear).toBeCloseTo(1, 10);
    }
  });

  it("評分越高，多頭機率越高、空頭機率越低", () => {
    const strong = scenarioProbabilities(5);
    const weak = scenarioProbabilities(-5);
    expect(strong.pBull).toBeGreaterThan(weak.pBull);
    expect(strong.pBear).toBeLessThan(weak.pBear);
  });
});

describe("bullAtrMultiple", () => {
  it("依評分分五段放大", () => {
    expect(bullAtrMultiple(5)).toBe(4);
    expect(bullAtrMultiple(3)).toBe(3);
    expect(bullAtrMultiple(1)).toBe(2.5);
    expect(bullAtrMultiple(-1)).toBe(2);
    expect(bullAtrMultiple(-5)).toBe(1.5);
  });
});

describe("calcEV 交易計畫", () => {
  it("價位順序必為 停損 < 進場 < 停利", () => {
    const r = calcEV(input({ revenueYoY: 70, foreignNet20dShares: 3_000_000 }));
    const entryMid = ((r.entryLow as number) + (r.entryHigh as number)) / 2;
    expect(r.stopLoss).toBeLessThan(entryMid);
    expect(entryMid).toBeLessThan(r.takeProfit as number);
  });

  it("停損距離恰為 2 個 ATR", () => {
    const atr = 7;
    const r = calcEV(input({ atr }));
    const entryMid = ((r.entryLow as number) + (r.entryHigh as number)) / 2;
    expect(entryMid - (r.stopLoss as number)).toBeCloseTo(2 * atr, 1);
  });

  it("風報比等於多頭倍數除以 2", () => {
    // 站上雙均線本身 +2，故 yoy=0 -> 評分 2（倍數 3.0）；yoy=70 再 +3 -> 評分 5（倍數 4.0）
    for (const [yoy, expectedScore, expectedRR] of [
      [0, 2, 3.0 / 2],
      [70, 5, 4.0 / 2],
    ] as const) {
      const r = calcEV(input({ revenueYoY: yoy }));
      expect(r.evScore).toBe(expectedScore);
      expect(r.riskRewardRatio).toBeCloseTo(expectedRR, 2);
    }
  });

  it("每張損益 = 價差 × 1000 股", () => {
    const r = calcEV(input());
    const entryMid = ((r.entryLow as number) + (r.entryHigh as number)) / 2;
    expect(r.riskPerLot).toBe(Math.round((entryMid - (r.stopLoss as number)) * 1000));
    expect(r.rewardPerLot).toBe(Math.round(((r.takeProfit as number) - entryMid) * 1000));
  });

  it("同評分但波動不同的兩檔，期望值不會相同", () => {
    const calm = calcEV(input({ atr: 2 }));
    const wild = calcEV(input({ atr: 20 }));
    expect(calm.evScore).toBe(wild.evScore);
    expect(calm.ev).not.toBe(wild.ev);
  });

  it("離月線超過 2 個 ATR 判為追高，需等回檔", () => {
    // 現價 100、月線 95、ATR 1 -> 乖離 5 > 2
    expect(calcEV(input({ atr: 1 })).entryTiming).toBe("wait_pullback");
    // ATR 放大到 5 -> 乖離 5 不超過 10，可進場
    expect(calcEV(input({ atr: 5 })).entryTiming).toBe("now");
  });

  it("跌破雙均線時不追，進場區改為站回月線之上", () => {
    const r = calcEV(input({ maSignal: "below_both", currentPrice: 80, ma20: 95 }));
    expect(r.entryTiming).toBe("avoid");
    expect(r.entryLow).toBe(95);
    expect(r.entryHigh).toBeGreaterThan(95);
  });

  it("站上均線時進場區上緣為現價，下緣不低於月線", () => {
    const r = calcEV(input({ currentPrice: 100, ma20: 98, atr: 10 }));
    expect(r.entryHigh).toBe(100);
    expect(r.entryLow).toBe(98); // 現價-ATR=90 會被月線 98 擋住
  });

  it("缺少 ATR 時不給任何價位，並標為資料不足", () => {
    const r = calcEV(input({ atr: null }));
    expect(r.entryTiming).toBe("insufficient_data");
    expect(r.stopLoss).toBeNull();
    expect(r.takeProfit).toBeNull();
    expect(r.riskRewardRatio).toBeNull();
    expect(r.atrPct).toBeNull();
    expect(r.ev).toBe(0);
  });

  it("三情境報酬率依 ATR 佔股價比例縮放", () => {
    const r = calcEV(input({ atr: 5, currentPrice: 100 })); // atrPct = 5%
    expect(r.atrPct).toBeCloseTo(5, 2);
    expect(r.rBear).toBeCloseTo(-10, 1); // -2 ATR
    expect(r.rBase).toBeCloseTo(2.5, 1); // +0.5 ATR
  });

  it("期望值訊號依門檻分級", () => {
    expect(calcEV(input({ atr: null })).evSignal).toBe("watch_positive"); // ev = 0
    const strong = calcEV(input({ revenueYoY: 70, foreignNet20dShares: 3_000_000, atr: 20 }));
    expect(strong.ev).toBeGreaterThan(8);
    expect(strong.evSignal).toBe("strong_buy");
  });

  describe("追高分支的進場區間", () => {
    it("判定追高時上緣壓在現價之下 —— 否則畫面一邊說等回檔、一邊給含現價的區間", () => {
      // 現價 100、月線 85、ATR 5 → 100−85=15 > 2×5，判定追高
      const out = calcEV(input({ currentPrice: 100, ma20: 85, ma60: 80, atr: 5 }));
      expect(out.entryTiming).toBe("wait_pullback");
      expect(out.entryHigh!).toBeLessThan(100);
    });

    it("未追高時上緣仍為現價", () => {
      const out = calcEV(input({ currentPrice: 100, ma20: 95, ma60: 90, atr: 5 }));
      expect(out.entryTiming).toBe("now");
      expect(out.entryHigh).toBe(100);
    });

    it("各種波動與價位下，追高的進場區間都確實落在現價之下且仍為有效區間", () => {
      // 取整到檔位後上緣可能塌回現價 —— 逐點檢查，不是抽樣
      for (const currentPrice of [8, 45, 90, 300, 800, 1500]) {
        for (const atr of [0.05, 0.5, 3, 12]) {
          const out = calcEV(
            input({
              currentPrice,
              ma20: currentPrice - 3 * atr,
              ma60: currentPrice - 4 * atr,
              atr,
            }),
          );
          expect(out.entryTiming).toBe("wait_pullback");
          expect(out.entryHigh!).toBeLessThan(currentPrice);
          expect(out.entryLow!).toBeLessThanOrEqual(out.entryHigh!);
        }
      }
    });
  });
});

describe("horizonFactor 時間尺度", () => {
  it("以 3 個月為基準，係數為 1", () => {
    expect(horizonFactor("3m")).toBe(1);
  });

  it("依 √交易日數縮放", () => {
    expect(horizonFactor("1m")).toBeCloseTo(Math.sqrt(20 / 60), 6); // ≈0.577
    expect(horizonFactor("6m")).toBeCloseTo(Math.sqrt(120 / 60), 6); // ≈1.414
  });

  it("未提供或無效值退回基準週期", () => {
    expect(horizonFactor()).toBe(1);
    expect(horizonFactor(null)).toBe(1);
    expect(horizonFactor("12m")).toBe(1);
    expect(horizonFactor("")).toBe(1);
  });

  it("週期越長係數越大", () => {
    expect(horizonFactor("1m")).toBeLessThan(horizonFactor("3m"));
    expect(horizonFactor("3m")).toBeLessThan(horizonFactor("6m"));
  });
});

describe("分析週期實際影響交易計畫", () => {
  const short = calcEV(input({ period: "1m" }));
  const base = calcEV(input({ period: "3m" }));
  const long = calcEV(input({ period: "6m" }));

  it("三種週期算出不同的停損與停利（先前完全相同）", () => {
    expect(new Set([short.stopLoss, base.stopLoss, long.stopLoss]).size).toBe(3);
    expect(new Set([short.takeProfit, base.takeProfit, long.takeProfit]).size).toBe(3);
  });

  it("週期越長停損越遠、停利越高", () => {
    expect(short.stopLoss!).toBeGreaterThan(base.stopLoss!);
    expect(base.stopLoss!).toBeGreaterThan(long.stopLoss!);
    expect(short.takeProfit!).toBeLessThan(base.takeProfit!);
    expect(base.takeProfit!).toBeLessThan(long.takeProfit!);
  });

  it("停損停利同步縮放，風報比不隨週期改變", () => {
    expect(short.riskRewardRatio).toBe(base.riskRewardRatio);
    expect(long.riskRewardRatio).toBe(base.riskRewardRatio);
  });

  it("情境機率不隨週期改變 —— 沒有另訂一組未驗證的機率", () => {
    for (const r of [short, long]) {
      expect(r.pBull).toBe(base.pBull);
      expect(r.pBase).toBe(base.pBase);
      expect(r.pBear).toBe(base.pBear);
    }
  });

  it("期望值隨時間尺度等比放大", () => {
    expect(long.ev / base.ev).toBeCloseTo(horizonFactor("6m"), 1);
    expect(short.ev / base.ev).toBeCloseTo(horizonFactor("1m"), 1);
  });

  it("進場區間不受週期影響（是即期問題，不是持有期間問題）", () => {
    expect(short.entryLow).toBe(base.entryLow);
    expect(long.entryHigh).toBe(base.entryHigh);
  });

  it("未指定週期時等同基準週期", () => {
    expect(calcEV(input())).toEqual(base);
  });

  it("回報實際採用的係數供畫面說明數字來源", () => {
    expect(long.horizonFactor).toBeCloseTo(1.41, 2);
    expect(base.horizonFactor).toBe(1);
  });

  it("每張風險金額隨週期放大，部位計算才會跟著縮小", () => {
    expect(long.riskPerLot!).toBeGreaterThan(base.riskPerLot!);
    expect(short.riskPerLot!).toBeLessThan(base.riskPerLot!);
  });
});

describe("價位取整到合法檔位", () => {
  it("所有輸出價位都是該價位檔位的整數倍", () => {
    // 高價股最容易露餡：2000 元附近的檔位是 5 元
    for (const currentPrice of [8.3, 27.6, 63.4, 251.7, 777.3, 2407.5]) {
      const r = calcEV(input({ currentPrice, ma20: currentPrice * 0.97, atr: currentPrice * 0.04 }));
      for (const price of [r.entryLow, r.entryHigh, r.stopLoss, r.takeProfit, r.firstTarget]) {
        if (price === null) continue;
        const tick = tickSize(price);
        expect(Math.round(price * 100) % Math.round(tick * 100)).toBe(0);
      }
    }
  });

  it("千元以上個股不再出現無法下單的小數價", () => {
    const r = calcEV(input({ currentPrice: 2407.46, ma20: 2356.25, atr: 170.71 }));
    for (const price of [r.stopLoss!, r.takeProfit!]) {
      expect(price % 5).toBe(0);
    }
  });
});

describe("第一目標由後端計算", () => {
  it("與停損等距（1R）", () => {
    const r = calcEV(input({ revenueYoY: 70 })); // 評分 5，倍數 4.0，停利遠高於 1R
    const mid = (r.entryLow! + r.entryHigh!) / 2;
    const risk = mid - r.stopLoss!;
    const reward = r.firstTarget! - mid;
    // 兩者都取整到檔位，故容許半個檔位的誤差
    expect(Math.abs(reward - risk)).toBeLessThanOrEqual(tickSize(r.firstTarget!) / 2 + 1e-9);
  });

  it("停利落在 1R 以內時為 null（分批出場沒有意義）", () => {
    // 評分 -5 → 多頭倍數 1.5，小於停損的 2.0
    const r = calcEV(
      input({ revenueYoY: -30, maSignal: "below_both", foreignNet20dShares: -3_000_000 }),
    );
    expect(r.evScore).toBeLessThan(-2);
    expect(r.firstTarget).toBeNull();
  });

  it("第一目標必定低於停利", () => {
    const r = calcEV(input({ revenueYoY: 70 }));
    expect(r.firstTarget!).toBeLessThan(r.takeProfit!);
  });

  it("缺少 ATR 時為 null", () => {
    expect(calcEV(input({ atr: null })).firstTarget).toBeNull();
  });

  it("隨分析週期一起伸縮", () => {
    const short = calcEV(input({ revenueYoY: 70, period: "1m" }));
    const long = calcEV(input({ revenueYoY: 70, period: "6m" }));
    expect(long.firstTarget!).toBeGreaterThan(short.firstTarget!);
  });
});
