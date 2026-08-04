import { beforeEach, describe, expect, it } from 'vitest';

// 必須排在被測模組之前：vitest 跑 node 環境沒有 localStorage，
// 這個模組在被 import 的當下就把記憶體替身掛上 globalThis。
// 比照 history.test.ts 的做法，不為了幾個 key-value 操作改用 jsdom。
import stub from '../../../../test/localStorageStub';
import { latestFor, loadVerify, saveVerify, type StoredVerify } from './verifyStore';

beforeEach(() => stub.__reset());

const tally = {
  target: 6,
  stop: 4,
  ambiguous: 0,
  open: 0,
  noEntry: 40,
  unknown: 0,
  decided: 10,
  targetRate: 60,
  entered: 10,
  entryRate: 20,
};

const sample: StoredVerify[] = [{ ruleVersion: 3, tally, verifiedAt: 1_770_000_000_000 }];

describe('verifyStore', () => {
  it('存進去再讀回來是同一份 —— 離開頁面不該讓使用者重按一次對答案', () => {
    saveVerify(sample);
    expect(loadVerify()).toEqual(sample);
  });

  it('沒存過時回空陣列，不是 null —— 呼叫端不必再判一次', () => {
    expect(loadVerify()).toEqual([]);
  });

  it('內容壞掉時當作沒存過，不讓一個壞字串把整張頁面帶下去', () => {
    stub.__seed('verify_results_v1', '{ 不是合法 JSON');
    expect(loadVerify()).toEqual([]);
  });

  it('存的不是陣列時也當作沒存過', () => {
    stub.__seed('verify_results_v1', '{"ruleVersion":3}');
    expect(loadVerify()).toEqual([]);
  });

  it('陣列裡混入形狀不對的項目時只濾掉那一筆，不整份丟棄', () => {
    stub.__seed('verify_results_v1', JSON.stringify([...sample, { 壞掉: true }]));
    expect(loadVerify()).toEqual(sample);
  });

  it('latestFor 取得指定規則版本的結果，混用不同版本的數字量不到任何一套規則', () => {
    const two: StoredVerify[] = [
      { ruleVersion: 2, tally, verifiedAt: 1 },
      { ruleVersion: 3, tally: { ...tally, targetRate: 71 }, verifiedAt: 2 },
    ];
    expect(latestFor(two, 3)?.tally.targetRate).toBe(71);
    expect(latestFor(two, 2)?.tally.targetRate).toBe(60);
  });

  it('查無該版本時回 null —— 卡片就不顯示，不要拿別版的命中率頂替', () => {
    expect(latestFor(sample, 99)).toBeNull();
    expect(latestFor([], 3)).toBeNull();
  });
});
