import { describe, expect, it } from 'vitest';

import { buildPriceMap, LABEL_MIN_GAP, priceMapNote, type PriceMapInput } from './priceMap';

/** 一份價位齊全、計畫成立的輸入 */
const FULL: PriceMapInput = {
  planKind: 'immediate',
  currentPrice: 110,
  entryLow: 104,
  entryHigh: 108,
  stopLoss: 100,
  takeProfit: 120,
  firstTarget: 115,
  ma20: 106,
  ma60: 102,
  swingHigh: 118,
  swingLow: 101,
};

const keysOf = (input: PriceMapInput) => buildPriceMap(input).map((l) => l.key);
const find = (input: PriceMapInput, key: string) =>
  buildPriceMap(input).find((l) => l.key === key);

describe('比例尺', () => {
  it('最低與最高分別落在上下邊距上，其餘依真實比例內插', () => {
    const levels = buildPriceMap({
      planKind: 'immediate',
      currentPrice: 110,
      stopLoss: 100,
      takeProfit: 120,
    });
    const pct = Object.fromEntries(levels.map((l) => [l.key, l.pct]));
    expect(pct['stop_loss']).toBeCloseTo(8);
    expect(pct['take_profit']).toBeCloseTo(92);
    // 110 是 100~120 的正中間
    expect(pct['current']).toBeCloseTo(50);
  });

  it('只有一個價位時放在正中間，不因為除以零而爆掉', () => {
    const levels = buildPriceMap({ planKind: 'none', currentPrice: 110 });
    expect(levels).toHaveLength(1);
    expect(levels[0]!.pct).toBe(50);
  });

  it('所有價位相同時全部放在正中間', () => {
    const levels = buildPriceMap({
      planKind: 'immediate',
      currentPrice: 100,
      stopLoss: 100,
      takeProfit: 100,
    });
    expect(levels.map((l) => l.pct)).toEqual([50, 50, 50]);
  });

  it('由低到高排列，畫的人不必自己再排一次', () => {
    const values = buildPriceMap(FULL).map((l) => l.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});

describe('planKind 為 none', () => {
  const noPlan: PriceMapInput = { ...FULL, planKind: 'none' };

  it('不畫進場區、停損、停利、第一目標', () => {
    // 交易計畫區塊在這個狀態整塊不印（「目前不提供進場區間與停損停利」），
    // 地圖照畫等於把剛抑制掉的矛盾用圖再講一次
    const keys = keysOf(noPlan);
    for (const suppressed of ['entry_low', 'entry_high', 'stop_loss', 'take_profit', 'first_target']) {
      expect(keys).not.toContain(suppressed);
    }
  });

  it('仍畫現價、月線、季線與 20 日高低 —— 那些是事實，不是計畫', () => {
    expect(keysOf(noPlan).sort()).toEqual(
      ['current', 'ma20', 'ma60', 'swing_high', 'swing_low'].sort(),
    );
  });

  it('比例尺只依剩下的價位算，不被拿掉的停損停利撐開', () => {
    // 剩下的範圍是 101~118，最低的 swing_low 必須貼在下邊距上
    expect(find(noPlan, 'swing_low')!.pct).toBeCloseTo(8);
    expect(find(noPlan, 'swing_high')!.pct).toBeCloseTo(92);
  });

  it('其他 planKind 照畫完整計畫', () => {
    for (const planKind of ['immediate', 'conditional', 'pullback'] as const) {
      expect(keysOf({ ...FULL, planKind })).toContain('stop_loss');
    }
  });
});

describe('缺值', () => {
  it('null 與 undefined 的價位一律略過', () => {
    const keys = keysOf({
      planKind: 'immediate',
      currentPrice: 110,
      stopLoss: null,
      takeProfit: 120,
      ma20: undefined,
    });
    expect(keys.sort()).toEqual(['current', 'take_profit'].sort());
  });

  it('全部缺值時回空陣列，讓呼叫端整塊不渲染', () => {
    expect(buildPriceMap({ planKind: 'immediate' })).toEqual([]);
  });

  it('非有限數（NaN、Infinity）當作缺值', () => {
    expect(keysOf({ planKind: 'immediate', currentPrice: 110, stopLoss: NaN })).toEqual(['current']);
  });
});

describe('與現價的距離', () => {
  it('高於現價為正、低於現價為負', () => {
    expect(find(FULL, 'take_profit')!.fromCurrent).toBeCloseTo((120 - 110) / 110 * 100);
    expect(find(FULL, 'stop_loss')!.fromCurrent).toBeCloseTo((100 - 110) / 110 * 100);
  });

  it('現價自己不標距離', () => {
    expect(find(FULL, 'current')!.fromCurrent).toBeNull();
  });

  it('沒有現價時全部不標距離 —— 沒有基準的百分比講不出任何事', () => {
    const levels = buildPriceMap({ planKind: 'immediate', stopLoss: 100, takeProfit: 120 });
    expect(levels.every((l) => l.fromCurrent === null)).toBe(true);
  });
});

describe('移動停損', () => {
  it('畫在圖上 —— 它是一個價位，先前只是卡片底下的一個灰籤', () => {
    const levels = buildPriceMap({ ...FULL, trailingStop: 98 });
    expect(levels.map((l) => l.key)).toContain('trailing_stop');
  });

  it('沒給就不畫，與其他價位一致', () => {
    expect(buildPriceMap(FULL).map((l) => l.key)).not.toContain('trailing_stop');
  });

  it('計畫不成立時不畫 —— 它與停損停利同屬那份計畫', () => {
    const levels = buildPriceMap({ ...FULL, trailingStop: 98, planKind: 'none' });
    expect(levels.map((l) => l.key)).not.toContain('trailing_stop');
  });
});

describe('主次分層', () => {
  it('計畫價位與現價標為主要，均線與 20 日高低標為次要', () => {
    const byKey = Object.fromEntries(
      buildPriceMap({ ...FULL, trailingStop: 98 }).map((l) => [l.key, l.emphasis]),
    );
    // 這一組是使用者要抄進下單畫面的數字
    for (const key of ['current', 'entry_low', 'entry_high', 'stop_loss', 'take_profit']) {
      expect(byKey[key]).toBe('primary');
    }
    // 這一組是用來判斷上面那組合不合理的背景
    for (const key of ['ma20', 'ma60', 'swing_high', 'swing_low']) {
      expect(byKey[key]).toBe('context');
    }
  });
});

describe('用詞', () => {
  const labelOf = (input: PriceMapInput, key: string) =>
    buildPriceMap(input).find((l) => l.key === key)?.label;

  it('預設沿用技術用語', () => {
    expect(labelOf(FULL, 'ma20')).toBe('月線');
    expect(labelOf(FULL, 'ma60')).toBe('季線');
  });

  it('新手視圖講白話 —— 同一張卡片不該有兩套詞', () => {
    // 右欄的均線位置在新手視圖被翻成「近月平均」，左欄的地圖若仍寫「月線」，
    // 讀的人得自己猜那是不是同一件事
    const plain: PriceMapInput = { ...FULL, glossary: 'plain' };
    expect(labelOf(plain, 'ma20')).toBe('近月均價');
    expect(labelOf(plain, 'ma60')).toBe('近季均價');
  });

  it('停損停利與 20 日高低兩套視圖同名 —— 卡片其他地方本來就這樣寫', () => {
    const plain: PriceMapInput = { ...FULL, glossary: 'plain' };
    for (const key of ['stop_loss', 'take_profit', 'swing_low', 'swing_high', 'current']) {
      expect(labelOf(plain, key)).toBe(labelOf(FULL, key));
    }
  });
});

describe('priceMapNote', () => {
  it('計畫尚未成立時明講那組價位還不能用', () => {
    // 卡片其他兩處都寫了「尚未成立」「成立後進場區」，地圖不能是唯一沉默的那個
    expect(priceMapNote('conditional')).toContain('成立');
  });

  it('計畫不成立時說明為何只剩現價與均線', () => {
    expect(priceMapNote('none')).toContain('停損');
  });

  it('計畫可直接執行時沒有注記，不製造無謂的字', () => {
    expect(priceMapNote('immediate')).toBeNull();
    expect(priceMapNote('pullback')).toBeNull();
  });
});

describe('標籤去疊', () => {
  it('價位靠太近時標籤被推開，但刻度線留在真實位置', () => {
    // 100.0 / 100.1 / 100.2 擠在一起，真實比例上幾乎重疊
    const levels = buildPriceMap({
      planKind: 'immediate',
      stopLoss: 100,
      currentPrice: 100.1,
      takeProfit: 100.2,
    });
    const gaps = levels.slice(1).map((l, i) => l.labelPct - levels[i]!.labelPct);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(LABEL_MIN_GAP - 1e-9);

    // 線本身不能被推 —— 推了這張圖就在說謊
    const pcts = levels.map((l) => l.pct);
    expect(pcts[0]).toBeCloseTo(8);
    expect(pcts[1]).toBeCloseTo(50);
    expect(pcts[2]).toBeCloseTo(92);
  });

  it('價位夠開時標籤就待在刻度線上，不做無謂位移', () => {
    const levels = buildPriceMap({
      planKind: 'immediate',
      stopLoss: 100,
      currentPrice: 110,
      takeProfit: 120,
    });
    for (const l of levels) expect(l.labelPct).toBeCloseTo(l.pct);
  });

  it('價位擠在軸頂時標籤往下回推，不溢出畫布', () => {
    // 一個遠低的 20 日低點把比例尺拉開，其餘九個全擠在頂端 ——
    // 只往上推會把最後幾個標籤推到 100 以外，畫布外的字等於沒有
    const levels = buildPriceMap({
      planKind: 'immediate',
      swingLow: 100,
      currentPrice: 199.1,
      entryLow: 199.2,
      entryHigh: 199.3,
      stopLoss: 199.4,
      ma20: 199.5,
      ma60: 199.6,
      firstTarget: 199.7,
      swingHigh: 199.8,
      takeProfit: 199.9,
    });
    expect(levels).toHaveLength(10);
    for (const l of levels) {
      expect(l.labelPct).toBeGreaterThanOrEqual(0);
      expect(l.labelPct).toBeLessThanOrEqual(100);
    }
    const gaps = levels.slice(1).map((l, i) => l.labelPct - levels[i]!.labelPct);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(LABEL_MIN_GAP - 1e-9);
  });
});
