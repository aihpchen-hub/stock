import { describe, expect, it } from "vitest";

import {
  buildChips,
  judgeTrend,
  sumLastDays,
  toDailyNets,
  type DailyNet,
  type InstitutionalRow,
} from "./chips";

/** 造一列 FinMind 格式的記錄；淨額以 buy 表達，sell 固定為 0 便於閱讀 */
function row(date: string, name: string, net: number): InstitutionalRow {
  return net >= 0
    ? { date, name, buy: net, sell: 0 }
    : { date, name, buy: 0, sell: -net };
}

/** 由每日外資淨額造出序列，日期為 2026-01-01 起連續遞增（僅需可排序） */
function seriesOf(foreignNets: number[]): DailyNet[] {
  return foreignNets.map((foreign, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    foreign,
    trust: 0,
    dealer: 0,
  }));
}

describe("toDailyNets", () => {
  it("同一天的多個法人別各自歸入自己的桶", () => {
    const nets = toDailyNets([
      row("2026-01-02", "Foreign_Investor", 1000),
      row("2026-01-02", "Investment_Trust", 500),
      row("2026-01-02", "Dealer_self", -200),
    ]);
    expect(nets).toEqual([{ date: "2026-01-02", foreign: 1000, trust: 500, dealer: -200 }]);
  });

  it("外資自營併入外資、避險部位併入自營商", () => {
    const nets = toDailyNets([
      row("2026-01-02", "Foreign_Investor", 1000),
      row("2026-01-02", "Foreign_Dealer_Self", 300),
      row("2026-01-02", "Dealer_self", 100),
      row("2026-01-02", "Dealer_Hedging", 50),
    ]);
    expect(nets[0]?.foreign).toBe(1300);
    expect(nets[0]?.dealer).toBe(150);
  });

  it("依日期由舊到新排序，不假設來源已排好", () => {
    const nets = toDailyNets([
      row("2026-01-05", "Foreign_Investor", 3),
      row("2026-01-02", "Foreign_Investor", 1),
      row("2026-01-03", "Foreign_Investor", 2),
    ]);
    expect(nets.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-03", "2026-01-05"]);
  });

  it("認不得的法人別直接忽略，不併進任何一桶", () => {
    const nets = toDailyNets([
      row("2026-01-02", "Foreign_Investor", 1000),
      row("2026-01-02", "Some_New_Category", 9999),
    ]);
    expect(nets).toEqual([{ date: "2026-01-02", foreign: 1000, trust: 0, dealer: 0 }]);
  });

  it("buy 與 sell 相減，不是只看 buy", () => {
    const nets = toDailyNets([{ date: "2026-01-02", name: "Investment_Trust", buy: 800, sell: 300 }]);
    expect(nets[0]?.trust).toBe(500);
  });
});

describe("sumLastDays", () => {
  const series = seriesOf([1, 2, 3, 4, 5]);

  it("取最後 n 天求和", () => {
    expect(sumLastDays(series, 3, "foreign")).toBe(12);
  });

  it("剛好等於資料長度時可計算", () => {
    expect(sumLastDays(series, 5, "foreign")).toBe(15);
  });

  it("天數不足時回傳 null，不用較少的天數硬湊", () => {
    expect(sumLastDays(series, 20, "foreign")).toBeNull();
  });
});

describe("judgeTrend", () => {
  // 日均量 1000 股。參與率門檻 2.5%：20 日窗需 |淨額| ≥ 500 股、
  // 5 日窗需 ≥ 125 股。以下用每天 1000 股等級的數字，遠高於兩者。
  const avgVol = 1000;

  it("不足 20 個交易日時不給判斷", () => {
    expect(judgeTrend(seriesOf(Array(19).fill(1000)), "foreign", avgVol)).toBe("insufficient_data");
  });

  it("買超且近 5 日日均高於 20 日日均 → 持續加碼", () => {
    // 前 15 天各 1000、後 5 天各 3000：avg20=1500、avg5=3000
    const s = seriesOf([...Array(15).fill(1000), ...Array(5).fill(3000)]);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("accumulating");
  });

  it("買超但近 5 日日均低於 20 日日均 → 買盤退潮", () => {
    const s = seriesOf([...Array(15).fill(3000), ...Array(5).fill(1000)]);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("slowing");
  });

  it("20 日仍是買超但近 5 日已翻成賣超 → 態度轉變", () => {
    // 這正是 30 日累積會蓋掉的情況：累積仍為正 45000，近期卻在調節
    const s = seriesOf([...Array(15).fill(5000), ...Array(5).fill(-6000)]);
    expect(sumLastDays(s, 20, "foreign")).toBe(45_000);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("reversing_down");
  });

  it("賣超且近 5 日賣得更兇 → 賣壓加強", () => {
    const s = seriesOf([...Array(15).fill(-1000), ...Array(5).fill(-3000)]);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("distributing");
  });

  it("賣超但近 5 日賣壓減輕 → 趨緩", () => {
    const s = seriesOf([...Array(15).fill(-3000), ...Array(5).fill(-1000)]);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("easing");
  });

  it("20 日仍是賣超但近 5 日已翻成買超 → 態度轉變", () => {
    const s = seriesOf([...Array(15).fill(-5000), ...Array(5).fill(6000)]);
    expect(sumLastDays(s, 20, "foreign")).toBe(-45_000);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("reversing_up");
  });

  it("長短天期參與率都太低時視為無方向", () => {
    // 20 日累積 100 股（0.5%）、5 日 100 股（2%），兩者都低於 2.5%
    const s = seriesOf([...Array(19).fill(0), 100]);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("neutral");
  });

  it("20 日打平但近 5 日明顯買進時，不被長天期的平淡蓋掉", () => {
    // 前 15 天賣 -1200、近 5 日買 +1500，20 日淨額僅 +300（1.5%，不顯著）
    // 但 5 日窗 +1500 佔該期間成交量 30%，這正是使用者要看到的轉折
    const s = seriesOf([...Array(15).fill(-80), ...Array(5).fill(300)]);
    expect(sumLastDays(s, 20, "foreign")).toBe(300);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("reversing_up");
  });

  it("同理，20 日打平但近 5 日明顯賣出時要講出來", () => {
    const s = seriesOf([...Array(15).fill(80), ...Array(5).fill(-300)]);
    expect(sumLastDays(s, 20, "foreign")).toBe(-300);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("reversing_down");
  });

  it("近 5 日的翻向不夠顯著時不算轉變，只算力道變化", () => {
    // 20 日大幅買超，近 5 日僅小額賣出（5 日窗 -100 股，佔 2%，未達門檻）
    const s = seriesOf([...Array(15).fill(1000), ...Array(5).fill(-20)]);
    expect(judgeTrend(s, "foreign", avgVol)).toBe("slowing");
  });

  it("缺日均量時仍照方向陳述，只有完全打平才算中性", () => {
    const s = seriesOf([...Array(15).fill(1000), ...Array(5).fill(3000)]);
    expect(judgeTrend(s, "foreign", null)).toBe("accumulating");
    expect(judgeTrend(seriesOf(Array(20).fill(0)), "foreign", null)).toBe("neutral");
  });
});

describe("buildChips", () => {
  const rows: InstitutionalRow[] = [];
  for (let i = 1; i <= 20; i++) {
    const date = `2026-01-${String(i).padStart(2, "0")}`;
    rows.push(row(date, "Foreign_Investor", 1000));
    rows.push(row(date, "Investment_Trust", -500));
  }

  it("四個天期各自累積，單位維持股數", () => {
    const chips = buildChips(rows, 1000);
    expect(chips.foreign.windows).toEqual({ d1: 1000, d5: 5000, d10: 10_000, d20: 20_000 });
    expect(chips.trust.windows).toEqual({ d1: -500, d5: -2500, d10: -5000, d20: -10_000 });
  });

  it("回報實際交易日數，讓畫面能說明為何某些天期沒有值", () => {
    expect(buildChips(rows.slice(0, 12), 1000).tradingDays).toBe(6);
  });

  it("交易日不足時四個天期依序退回 null，不會整塊消失", () => {
    const chips = buildChips(rows.slice(0, 2 * 7), 1000);
    expect(chips.foreign.windows.d5).toBe(5000);
    expect(chips.foreign.windows.d10).toBeNull();
    expect(chips.foreign.windows.d20).toBeNull();
    expect(chips.foreign.trend).toBe("insufficient_data");
  });

  it("完全沒有資料時不丟例外", () => {
    const chips = buildChips([], null);
    expect(chips.tradingDays).toBe(0);
    expect(chips.foreign.windows.d1).toBeNull();
    expect(chips.foreign.trend).toBe("insufficient_data");
  });
});
