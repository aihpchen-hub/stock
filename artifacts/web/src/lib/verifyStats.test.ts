import { describe, expect, it } from 'vitest';

import { MIN_DECIDED, isConclusive, mergeTallies, wilson95 } from './verifyStats';

type Tally = Parameters<typeof mergeTallies>[0][number];

function tally(over: Partial<Tally> = {}): Tally {
  return {
    target: 0,
    stop: 0,
    ambiguous: 0,
    open: 0,
    noEntry: 0,
    unknown: 0,
    decided: 0,
    entered: 0,
    targetRate: null,
    entryRate: null,
    ...over,
  };
}

describe('isConclusive', () => {
  it('已結案筆數不足時不給結論', () => {
    // n=1 的 100.0% 先前用 text-2xl 印在首頁最顯眼處，還會出現在
    // 當天查的每一張卡片上，語氣是「這套規則目前實測」。
    expect(isConclusive(1)).toBe(false);
    expect(isConclusive(MIN_DECIDED - 1)).toBe(false);
  });

  it('達到門檻才給結論', () => {
    expect(isConclusive(MIN_DECIDED)).toBe(true);
    expect(isConclusive(MIN_DECIDED + 50)).toBe(true);
  });

  it('門檻至少要 20 筆 —— 再低的樣本講不出任何事', () => {
    expect(MIN_DECIDED).toBeGreaterThanOrEqual(20);
  });
});

describe('wilson95 信賴區間', () => {
  it('沒有樣本時回 null', () => {
    expect(wilson95(0, 0)).toBeNull();
  });

  it('小樣本的區間寬到足以說明它講不出結論', () => {
    // 1 戰 1 勝：點估計 100%，但區間下界遠低於它
    const [lo, hi] = wilson95(1, 1)!;
    expect(lo).toBeLessThan(30);
    expect(hi).toBeCloseTo(100, 0);
  });

  it('樣本越多區間越窄', () => {
    const [lo10, hi10] = wilson95(6, 10)!;
    const [lo100, hi100] = wilson95(60, 100)!;
    expect(hi100 - lo100).toBeLessThan(hi10 - lo10);
  });

  it('區間永遠落在 0~100 之內', () => {
    for (const [k, n] of [[0, 5], [5, 5], [3, 7], [0, 1]] as const) {
      const [lo, hi] = wilson95(k, n)!;
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(100);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });

  it('包含點估計值', () => {
    const [lo, hi] = wilson95(60, 100)!;
    expect(lo).toBeLessThanOrEqual(60);
    expect(hi).toBeGreaterThanOrEqual(60);
  });
});

describe('mergeTallies 分批合併', () => {
  it('逐欄相加', () => {
    const merged = mergeTallies([
      tally({ target: 3, stop: 2, decided: 5, entered: 6, open: 1, noEntry: 4 }),
      tally({ target: 1, stop: 4, decided: 5, entered: 5, open: 0, noEntry: 2 }),
    ]);
    expect(merged.target).toBe(4);
    expect(merged.stop).toBe(6);
    expect(merged.decided).toBe(10);
    expect(merged.entered).toBe(11);
    expect(merged.noEntry).toBe(6);
  });

  it('比率由合併後的分子分母重算，不是把兩個百分比平均', () => {
    // 平均兩個百分比會得到 (100 + 0) / 2 = 50%，那是錯的：
    // 真正的達標率是 1 勝 / (1 勝 + 9 敗) = 10%
    const merged = mergeTallies([
      tally({ target: 1, stop: 0, decided: 1, entered: 1, targetRate: 100 }),
      tally({ target: 0, stop: 9, decided: 9, entered: 9, targetRate: 0 }),
    ]);
    expect(merged.targetRate).toBeCloseTo(10, 5);
  });

  it('沒有已結案筆數時達標率為 null，不以 0% 假裝有結論', () => {
    const merged = mergeTallies([tally({ open: 3, noEntry: 2 }), tally({ open: 1 })]);
    expect(merged.targetRate).toBeNull();
  });

  it('成立率的分母是全部計畫，不是已結案的那些', () => {
    // 10 筆計畫，3 筆真的進場
    const merged = mergeTallies([
      tally({ target: 2, stop: 1, decided: 3, entered: 3, noEntry: 7 }),
    ]);
    expect(merged.entryRate).toBeCloseTo(30, 5);
  });

  it('空陣列回一個全零且兩個比率皆為 null 的結果', () => {
    const merged = mergeTallies([]);
    expect(merged.decided).toBe(0);
    expect(merged.targetRate).toBeNull();
    expect(merged.entryRate).toBeNull();
  });
});
