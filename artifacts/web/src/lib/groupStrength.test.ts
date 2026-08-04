import { describe, expect, it } from 'vitest';

import { rankByStrength } from './groupStrength';

describe('rankByStrength', () => {
  it('依 20 日報酬由強到弱排名，第一名 rank 為 1', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: 12 },
      { code: 'C', return20d: -3 },
    ]);
    expect(r['B']!.rank).toBe(1);
    expect(r['A']!.rank).toBe(2);
    expect(r['C']!.rank).toBe(3);
    expect(r['B']!.total).toBe(3);
  });

  it('標出族群最強與最弱 —— 使用者要問的是「同一條供應鏈裡它排第幾」', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: 12 },
      { code: 'C', return20d: -3 },
    ]);
    expect(r['B']!.leader).toBe(true);
    expect(r['C']!.laggard).toBe(true);
    expect(r['A']!.leader).toBe(false);
    expect(r['A']!.laggard).toBe(false);
  });

  it('缺報酬的標的不參與排名，也不佔用名次', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: null },
      { code: 'C', return20d: 1 },
    ]);
    expect(r['B']).toBeUndefined();
    expect(r['A']!.rank).toBe(1);
    expect(r['C']!.rank).toBe(2);
    expect(r['A']!.total).toBe(2);
  });

  it('只有一檔可比時不標最強也不標最弱 —— 一檔的排名沒有意義', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: null },
    ]);
    expect(r['A']!.leader).toBe(false);
    expect(r['A']!.laggard).toBe(false);
    expect(r['A']!.total).toBe(1);
  });

  it('同分時名次相同，不因輸入順序而改變', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: 5 },
      { code: 'C', return20d: 1 },
    ]);
    expect(r['A']!.rank).toBe(r['B']!.rank);
    expect(r['C']!.rank).toBe(3);
  });

  it('全部同分時沒有人是最弱的 —— 並列第一不該被標成落後', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: 5 },
    ]);
    expect(r['A']!.laggard).toBe(false);
    expect(r['B']!.laggard).toBe(false);
  });

  it('NaN 或 Infinity 視同缺值，不參與排名', () => {
    const r = rankByStrength([
      { code: 'A', return20d: 5 },
      { code: 'B', return20d: Number.NaN },
      { code: 'C', return20d: Number.POSITIVE_INFINITY },
    ]);
    expect(r['B']).toBeUndefined();
    expect(r['C']).toBeUndefined();
    expect(r['A']!.total).toBe(1);
  });

  it('空輸入回空物件，不崩潰', () => {
    expect(rankByStrength([])).toEqual({});
  });
});
