import { beforeEach, describe, expect, it } from 'vitest';

import stub from '../../../../test/localStorageStub';
import {
  MAX_ENTRIES,
  buildMeta,
  clearAll,
  formatHistoryTime,
  loadIndex,
  loadSnapshot,
  makeSnapshotId,
  remove,
  save,
  type AnalysisSnapshot,
} from './history';

beforeEach(() => stub.__reset());

type StockSpec = {
  code: string;
  name: string;
  ev: number | null;
  price?: number;
  /** 官方簡稱。未給代表明細裡沒有這個欄位 */
  stockName?: string;
};

/** 組一份最小可用的快照；型別由 API client 提供，此處只填測試需要的欄位 */
function snapshot(id: string, keyword: string, stocks: StockSpec[], createdAt = 1_700_000_000_000) {
  return {
    id,
    createdAt,
    keyword,
    period: '3m',
    analysis: {
      keyword,
      period: '3m',
      sentiment: 'bullish',
      summary: '',
      catalysts: [],
      stocks: stocks.map((s) => ({ code: s.code, name: s.name, reason: '', sector: '' })),
      newsItems: [],
    },
    stockDetails: Object.fromEntries(
      stocks.map((s) => [
        s.code,
        {
          code: s.code,
          ev: s.ev,
          evSignal: 'buy',
          currentPrice: s.price ?? 100,
          ...(s.stockName ? { stockName: s.stockName } : {}),
        },
      ]),
    ),
  } as unknown as AnalysisSnapshot;
}

describe('buildMeta', () => {
  it('挑出期望值最高的個股作為代表', () => {
    const meta = buildMeta(
      snapshot('a', '矽光子', [
        { code: '1111', name: '低', ev: 1.0, price: 50 },
        { code: '2222', name: '高', ev: 9.9, price: 80 },
        { code: '3333', name: '中', ev: 5.0, price: 60 },
      ]),
    );
    expect(meta.topCode).toBe('2222');
    expect(meta.topEv).toBe(9.9);
    expect(meta.topPrice).toBe(80);
  });

  it('忽略沒有期望值的個股', () => {
    const meta = buildMeta(
      snapshot('a', 'x', [
        { code: '1111', name: '無資料', ev: null },
        { code: '2222', name: '有資料', ev: 2.0 },
      ]),
    );
    expect(meta.topCode).toBe('2222');
  });

  it('全部都沒有期望值時代表欄位為 null，仍記錄檔數', () => {
    const meta = buildMeta(snapshot('a', 'x', [{ code: '1111', name: '無', ev: null }]));
    expect(meta.topCode).toBeNull();
    expect(meta.topEv).toBeNull();
    expect(meta.stockCount).toBe(1);
  });

  // 紀錄列印的是「領先標的」，也就是期望值最高的那檔。查個股時那通常不是
  // 使用者查的那一檔 —— 查 5439 的紀錄會寫「領先標的: 台燿」，回頭看完全
  // 認不出這筆是在查什麼。
  it('查個股時記下查詢標的，用官方簡稱', () => {
    const meta = buildMeta(
      snapshot('a', '5439', [
        { code: '6274', name: '台燿', ev: 21.3 },
        { code: '5439', name: '高技', ev: -0.6, stockName: '高技' },
      ]),
    );
    expect(meta.queriedCode).toBe('5439');
    expect(meta.queriedName).toBe('高技');
    // 領先標的仍然是期望值最高的那檔，兩者各自回答不同的問題
    expect(meta.topCode).toBe('6274');
  });

  it('明細缺官方簡稱時退回模型給的名稱', () => {
    const meta = buildMeta(
      snapshot('a', '5439', [{ code: '5439', name: '高技', ev: 1.0 }]),
    );
    expect(meta.queriedName).toBe('高技');
  });

  it('查產業關鍵字時兩個欄位都是 null', () => {
    const meta = buildMeta(
      snapshot('a', '矽光子', [{ code: '6274', name: '台燿', ev: 21.3 }]),
    );
    expect(meta.queriedCode).toBeNull();
    expect(meta.queriedName).toBeNull();
  });
});

describe('存讀往返', () => {
  it('存進去的快照可以完整讀回', async () => {
    const snap = snapshot('id-1', '矽光子', [{ code: '8111', name: '立碁', ev: 9.3 }]);
    await save(snap);

    const index = await loadIndex();
    expect(index).toHaveLength(1);
    expect(index[0]?.keyword).toBe('矽光子');

    const loaded = await loadSnapshot('id-1');
    expect(loaded?.analysis.stocks[0]?.code).toBe('8111');
  });

  it('索引依時間新到舊排序', async () => {
    await save(snapshot('old', 'A', [{ code: '1', name: 'a', ev: 1 }], 1_000));
    await save(snapshot('new', 'B', [{ code: '2', name: 'b', ev: 2 }], 9_000));
    const index = await loadIndex();
    expect(index.map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('同一 id 重複儲存不會產生兩筆索引', async () => {
    await save(snapshot('dup', 'A', [{ code: '1', name: 'a', ev: 1 }]));
    await save(snapshot('dup', 'A', [{ code: '1', name: 'a', ev: 2 }]));
    expect(await loadIndex()).toHaveLength(1);
  });

  it('讀取不存在的 id 回傳 null', async () => {
    expect(await loadSnapshot('nope')).toBeNull();
  });
});

describe('筆數上限', () => {
  it(`超過 ${MAX_ENTRIES} 筆時汰除最舊的，且連同快照本體一起刪`, async () => {
    for (let i = 0; i < MAX_ENTRIES + 3; i++) {
      await save(snapshot(`id-${i}`, `kw-${i}`, [{ code: '1', name: 'a', ev: i }], 1_000 + i));
    }

    const index = await loadIndex();
    expect(index).toHaveLength(MAX_ENTRIES);
    // 最舊的三筆應已消失
    expect(index.find((e) => e.id === 'id-0')).toBeUndefined();
    expect(await loadSnapshot('id-0')).toBeNull();
    // 最新的仍在
    expect(await loadSnapshot(`id-${MAX_ENTRIES + 2}`)).not.toBeNull();
    // 不留孤兒快照
    const snapshotKeys = stub.__keys().filter((k) => k.startsWith('history_snapshot_'));
    expect(snapshotKeys).toHaveLength(MAX_ENTRIES);
  });
});

describe('刪除', () => {
  it('刪掉指定紀錄，其餘不受影響', async () => {
    await save(snapshot('a', 'A', [{ code: '1', name: 'a', ev: 1 }], 1_000));
    await save(snapshot('b', 'B', [{ code: '2', name: 'b', ev: 2 }], 2_000));

    const left = await remove('a');
    expect(left.map((e) => e.id)).toEqual(['b']);
    expect(await loadSnapshot('a')).toBeNull();
    expect(await loadSnapshot('b')).not.toBeNull();
  });

  it('清空後索引與快照都不留', async () => {
    await save(snapshot('a', 'A', [{ code: '1', name: 'a', ev: 1 }]));
    await clearAll();
    expect(await loadIndex()).toEqual([]);
    expect(stub.__keys()).toHaveLength(0);
  });
});

describe('損毀容錯', () => {
  it('索引不是合法 JSON 時視為空清單', async () => {
    stub.__seed('history_index_v1', '{{{ broken');
    expect(await loadIndex()).toEqual([]);
  });

  it('索引不是陣列時視為空清單', async () => {
    stub.__seed('history_index_v1', '{"a":1}');
    expect(await loadIndex()).toEqual([]);
  });

  it('索引中的壞資料被濾掉，好的仍保留', async () => {
    stub.__seed(
      'history_index_v1',
      JSON.stringify([{ id: 'ok', createdAt: 1, keyword: 'k' }, { nonsense: true }, null]),
    );
    const index = await loadIndex();
    expect(index).toHaveLength(1);
    expect(index[0]?.id).toBe('ok');
  });

  it('快照本體損毀時回傳 null 而非拋錯', async () => {
    stub.__seed('history_snapshot_bad', 'not json');
    expect(await loadSnapshot('bad')).toBeNull();
  });
});

describe('makeSnapshotId', () => {
  it('連續呼叫不重複', () => {
    const ids = new Set(Array.from({ length: 200 }, () => makeSnapshotId()));
    expect(ids.size).toBe(200);
  });
});

describe('formatHistoryTime', () => {
  const now = new Date('2026-07-30T14:30:00').getTime();

  it('今天顯示時分', () => {
    const t = new Date('2026-07-30T09:05:00').getTime();
    expect(formatHistoryTime(t, now)).toBe('09:05');
  });

  it('昨天顯示「昨天」', () => {
    const t = new Date('2026-07-29T23:59:00').getTime();
    expect(formatHistoryTime(t, now)).toBe('昨天');
  });

  it('更早顯示月/日', () => {
    const t = new Date('2026-07-03T10:00:00').getTime();
    expect(formatHistoryTime(t, now)).toBe('07/03');
  });

  it('跨月的昨天仍判為昨天', () => {
    const monthStart = new Date('2026-08-01T00:30:00').getTime();
    const lastDayOfJuly = new Date('2026-07-31T22:00:00').getTime();
    expect(formatHistoryTime(lastDayOfJuly, monthStart)).toBe('昨天');
  });
});
