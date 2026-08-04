import { describe, expect, it } from 'vitest';

import { queriedCode } from './queriedStock';

const STOCKS = [
  { code: '6274', name: '台燿' },
  { code: '2368', name: '金像電' },
  { code: '8155', name: '博智' },
  { code: '5439', name: '高技' },
];

describe('queriedCode', () => {
  it('查代號時認出名單裡的那一檔', () => {
    expect(queriedCode('5439', STOCKS)).toBe('5439');
  });

  it('查公司名時認出名單裡的那一檔', () => {
    expect(queriedCode('高技', STOCKS)).toBe('5439');
  });

  it('查產業關鍵字回 null —— 那不指向任何一檔', () => {
    expect(queriedCode('AI水冷散熱', STOCKS)).toBeNull();
  });

  it('代號有效但不在回傳名單裡時回 null，不硬指一檔', () => {
    expect(queriedCode('2330', STOCKS)).toBeNull();
  });

  it('前後空白不影響比對 —— 使用者貼上的字串常帶空白', () => {
    expect(queriedCode('  5439  ', STOCKS)).toBe('5439');
    expect(queriedCode(' 高技 ', STOCKS)).toBe('5439');
  });

  it('只做完全比對，不做部分比對', () => {
    // 「台」誤中台燿會在畫面上宣稱一件使用者沒做的事，比不標更糟
    expect(queriedCode('台', STOCKS)).toBeNull();
    expect(queriedCode('金像電子', STOCKS)).toBeNull();
  });

  it('空字串與空名單都回 null，不丟例外', () => {
    expect(queriedCode('', STOCKS)).toBeNull();
    expect(queriedCode('   ', STOCKS)).toBeNull();
    expect(queriedCode('5439', [])).toBeNull();
  });
});
