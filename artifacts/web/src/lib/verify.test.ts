import { beforeEach, describe, expect, it } from 'vitest';

import stub from '../../../../test/localStorageStub';
import { save, type AnalysisSnapshot } from './history';
import {
  LEGACY_RULE_VERSION,
  buildVerifyGroups,
  buildVerifyItems,
  isRipe,
  itemsFromSnapshot,
  toDateKey,
} from './verify';

beforeEach(() => stub.__reset());

const DAY = 24 * 60 * 60 * 1000;

function snapshot(over: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    id: 's1',
    createdAt: new Date(2026, 6, 1, 10, 0).getTime(),
    keyword: 'CPO',
    period: '3m',
    analysis: {
      keyword: 'CPO',
      period: '3m',
      sentiment: 'bullish',
      summary: '',
      catalysts: [],
      newsItems: [],
      stocks: [
        { code: '3363', name: '上詮', reason: '', sector: '光通訊' },
        { code: '3081', name: '聯亞', reason: '', sector: '光通訊' },
      ],
    },
    stockDetails: {
      '3363': { code: '3363', entryLow: 100, entryHigh: 104, stopLoss: 90, takeProfit: 120 },
      '3081': { code: '3081', entryLow: 50, entryHigh: 52, stopLoss: 45, takeProfit: 60 },
    },
    ...over,
  };
}

describe('toDateKey', () => {
  it('輸出本地日期並補零', () => {
    expect(toDateKey(new Date(2026, 0, 5, 23, 30).getTime())).toBe('2026-01-05');
  });

  it('不因時區偏移跑到前一天', () => {
    // 本地早上八點，UTC 仍是前一天
    expect(toDateKey(new Date(2026, 7, 1, 8, 0).getTime())).toBe('2026-08-01');
  });
});

describe('isRipe', () => {
  const now = new Date(2026, 6, 20).getTime();

  it('短線計畫等一週就值得對答案 —— 它的失效期限只有 10 個交易日', () => {
    expect(isRipe(now - 6 * DAY, '1m', now)).toBe(false);
    expect(isRipe(now - 7 * DAY, '1m', now)).toBe(true);
  });

  it('波段計畫要等更久 —— 失效期限 20 個交易日，太早問只會拿到「仍持有」', () => {
    expect(isRipe(now - 13 * DAY, '3m', now)).toBe(false);
    expect(isRipe(now - 14 * DAY, '3m', now)).toBe(true);
  });

  it('中長線計畫等最久 —— 30 個交易日約當六週', () => {
    expect(isRipe(now - 20 * DAY, '6m', now)).toBe(false);
    expect(isRipe(now - 21 * DAY, '6m', now)).toBe(true);
  });

  it('剛存下來的紀錄一律不驗證', () => {
    expect(isRipe(now, '1m', now)).toBe(false);
    expect(isRipe(now, '6m', now)).toBe(false);
  });

  it('週期缺失或認不得時退回基準週期，與 strategyFor 的處理一致', () => {
    expect(isRipe(now - 14 * DAY, null, now)).toBe(true);
    expect(isRipe(now - 13 * DAY, undefined, now)).toBe(false);
    expect(isRipe(now - 13 * DAY, '99y', now)).toBe(false);
  });
});

describe('itemsFromSnapshot', () => {
  it('每個有完整計畫的標的產生一筆', () => {
    const items = itemsFromSnapshot(snapshot());
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      code: '3363',
      from: '2026-07-01',
      entryLow: 100,
      entryHigh: 104,
      stopLoss: 90,
      takeProfit: 120,
    });
  });

  it('缺少任一價位的標的跳過，不補推估值', () => {
    const s = snapshot();
    s.stockDetails['3081'] = { code: '3081', entryLow: 50, entryHigh: 52, stopLoss: 45 }; // 沒有停利
    expect(itemsFromSnapshot(s).map((i) => i.code)).toEqual(['3363']);
  });

  it('完全沒有明細的標的跳過', () => {
    const s = snapshot();
    s.stockDetails = {};
    expect(itemsFromSnapshot(s)).toEqual([]);
  });

  it('起算日為快照建立日', () => {
    const s = snapshot({ createdAt: new Date(2026, 2, 15, 9, 0).getTime() });
    expect(itemsFromSnapshot(s).every((i) => i.from === '2026-03-15')).toBe(true);
  });
});

describe('buildVerifyItems', () => {
  const now = new Date(2026, 6, 20).getTime();

  it('只取夠舊的快照', async () => {
    const old = snapshot({ id: 'old', createdAt: now - 30 * DAY });
    const fresh = snapshot({ id: 'fresh', createdAt: now - 1 * DAY });
    const index = await save(old);
    const index2 = await save(fresh);
    expect(index2.length).toBe(2);
    expect(index.length).toBe(1);

    const items = await buildVerifyItems(index2, now);
    // 只有 old 的兩筆
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.from))).toEqual(new Set([toDateKey(old.createdAt)]));
  });

  it('沒有夠舊的快照時回空陣列', async () => {
    const index = await save(snapshot({ createdAt: now - 1 * DAY }));
    expect(await buildVerifyItems(index, now)).toEqual([]);
  });

  it('索引裡有但快照已遺失時跳過，不崩潰', async () => {
    const index = await save(snapshot({ id: 'gone', createdAt: now - 30 * DAY }));
    stub.__reset(); // 清掉快照本體，模擬資料遺失
    expect(await buildVerifyItems(index, now)).toEqual([]);
  });
});

describe('buildVerifyGroups', () => {
  const now = new Date(2026, 6, 20).getTime();

  /** 同一份快照裡兩檔標的分屬不同規則版本 —— 用來確認分組看的是每一筆而非整份快照 */
  function mixedSnapshot() {
    const s = snapshot({ id: 'mixed', createdAt: now - 30 * DAY });
    s.stockDetails['3363'] = { ...s.stockDetails['3363'], ruleVersion: 2 };
    // 3081 刻意不給 ruleVersion，代表規則第一版留下的舊資料
    return s;
  }

  it('依規則版本分組，新版排在前面', async () => {
    const index = await save(mixedSnapshot());
    const groups = await buildVerifyGroups(index, now);
    expect(groups.map((g) => g.ruleVersion)).toEqual([2, 1]);
  });

  it('沒有 ruleVersion 的舊快照視為初版', async () => {
    const index = await save(snapshot({ id: 'legacy', createdAt: now - 30 * DAY }));
    const groups = await buildVerifyGroups(index, now);
    expect(groups).toHaveLength(1);
    expect(groups[0].ruleVersion).toBe(LEGACY_RULE_VERSION);
    expect(groups[0].items).toHaveLength(2);
  });

  it('分組後的總筆數與不分組時相同 —— 不得漏掉任何一筆', async () => {
    const index = await save(mixedSnapshot());
    const flat = await buildVerifyItems(index, now);
    const groups = await buildVerifyGroups(index, now);
    expect(groups.reduce((sum, g) => sum + g.items.length, 0)).toBe(flat.length);
  });

  it('同樣只取夠舊的快照', async () => {
    await save(mixedSnapshot());
    const index = await save(snapshot({ id: 'fresh', createdAt: now - 1 * DAY }));
    const groups = await buildVerifyGroups(index, now);
    // fresh 那兩筆不夠舊，只剩 mixed 的兩筆分成兩組
    expect(groups.reduce((sum, g) => sum + g.items.length, 0)).toBe(2);
  });
});
