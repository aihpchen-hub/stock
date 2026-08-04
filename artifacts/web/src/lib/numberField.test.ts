import { describe, expect, it } from 'vitest';

import { commitNumber, isEditableDraft, toDraft } from './numberField';

describe('isEditableDraft', () => {
  it('允許空字串 —— 這正是先前刪不掉最後一位數字的原因', () => {
    expect(isEditableDraft('')).toBe(true);
  });

  it('允許編輯途中的中間狀態', () => {
    for (const s of ['1', '10', '1.', '0.', '.5', '-', '-1', '2.8']) {
      expect(isEditableDraft(s), s).toBe(true);
    }
  });

  it('擋掉非數字內容', () => {
    for (const s of ['abc', '1a', '1..2', '1-2', '1 2', '1e5']) {
      expect(isEditableDraft(s), s).toBe(false);
    }
  });
});

describe('commitNumber', () => {
  it('空白退回上一個值，不把空欄位夾成下限', () => {
    expect(commitNumber('', 1_000_000, { min: 1 })).toBe(1_000_000);
    expect(commitNumber('   ', 1_000_000, { min: 1 })).toBe(1_000_000);
  });

  it('解析不出數字時退回上一個值', () => {
    expect(commitNumber('.', 500, {})).toBe(500);
    expect(commitNumber('-', 500, {})).toBe(500);
  });

  it('超出範圍時夾到邊界 —— 那是使用者確實表達過的意圖', () => {
    expect(commitNumber('150', 30, { min: 1, max: 100 })).toBe(100);
    expect(commitNumber('0', 30, { min: 1, max: 100 })).toBe(1);
    expect(commitNumber('-5', 30, { min: 1, max: 100 })).toBe(1);
  });

  it('範圍內的值原樣通過', () => {
    expect(commitNumber('45', 30, { min: 1, max: 100 })).toBe(45);
  });

  it('金額欄位取整', () => {
    expect(commitNumber('20000.7', 1, { min: 1, integer: true })).toBe(20_001);
  });

  it('小數欄位保留小數', () => {
    expect(commitNumber('2.8', 10, { min: 1, max: 10 })).toBe(2.8);
  });

  it('沒有給範圍時不夾', () => {
    expect(commitNumber('-99', 5, {})).toBe(-99);
  });

  it('夾邊界先於取整，兩者不互相打架', () => {
    expect(commitNumber('100.6', 1, { min: 1, max: 100, integer: true })).toBe(100);
  });
});

describe('toDraft', () => {
  it('整數不留無意義的小數尾巴', () => {
    expect(toDraft(30)).toBe('30');
    expect(toDraft(1_000_000)).toBe('1000000');
  });

  it('小數保留原樣', () => {
    expect(toDraft(2.8)).toBe('2.8');
  });

  it('收掉浮點乘法的尾差 —— 0.3 × 100 會得到 30.000000000000004', () => {
    expect(toDraft(0.3 * 100)).toBe('30');
    expect(toDraft(0.28 * 10)).toBe('2.8');
    expect(toDraft(0.7 * 100)).toBe('70');
  });

  it('非數值回空字串，不印出 NaN', () => {
    expect(toDraft(NaN)).toBe('');
    expect(toDraft(Infinity)).toBe('');
  });
});
