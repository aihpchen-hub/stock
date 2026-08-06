import { describe, expect, it } from 'vitest';

import { queriedCode, queriedIdentity } from './queriedStock';

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

describe('queriedIdentity', () => {
  const DETAILS = {
    '5439': { stockName: '高技', officialIndustry: '電子零組件業' },
  };

  it('官方簡稱與官方產業別優先 —— 那是唯一可查核的來源', () => {
    expect(queriedIdentity('5439', STOCKS, DETAILS)).toEqual({
      code: '5439',
      name: '高技',
      industry: '電子零組件業',
    });
  });

  it('明細還沒載入時退回模型給的名稱，不讓標題空一塊', () => {
    expect(queriedIdentity('5439', STOCKS, {})).toEqual({
      code: '5439',
      name: '高技',
      industry: null,
    });
  });

  it('官方欄位為 null 時退回模型名稱，產業留 null', () => {
    const details = { '5439': { stockName: null, officialIndustry: null } };
    expect(queriedIdentity('5439', STOCKS, details)).toEqual({
      code: '5439',
      name: '高技',
      industry: null,
    });
  });

  it('查產業關鍵字時回 null —— 那次查詢沒有「這一檔」', () => {
    expect(queriedIdentity('AI水冷散熱', STOCKS, DETAILS)).toBeNull();
  });
});

describe("面對殘缺的標的清單不崩潰", () => {
  // 後端已經有 sanitizeStocks 擋，但舊的 localStorage 快照是在那之前存的，
  // 而 render 期間丟例外就是整棵樹卸載（全站沒有 ErrorBoundary）。
  const broken = [
    { code: "2330" },
    { name: "台積電" },
    null,
    undefined,
    { code: null, name: null },
  ] as unknown as Array<{ code: string; name: string }>;

  it("缺 name 的舊快照不會讓 queriedCode 丟 TypeError", () => {
    expect(() => queriedCode("台燿", broken)).not.toThrow();
    expect(queriedCode("台燿", broken)).toBeNull();
  });

  it("缺 code 的舊快照不會讓代號查詢丟 TypeError", () => {
    expect(() => queriedCode("2330", broken)).not.toThrow();
    expect(queriedCode("2330", broken)).toBe("2330");
  });

  it("queriedIdentity 同樣不受影響", () => {
    expect(() => queriedIdentity("台燿", broken, {})).not.toThrow();
    expect(queriedIdentity("台燿", broken, {})).toBeNull();
  });
});
