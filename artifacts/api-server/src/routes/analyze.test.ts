import { describe, expect, it } from "vitest";

import { normalizeClaims, normalizeSource, sanitizeStocks } from "./analyze";

describe("normalizeSource", () => {
  it("接受指向現有新聞的編號", () => {
    expect(normalizeSource(1, 4)).toBe(1);
    expect(normalizeSource(4, 4)).toBe(4);
  });

  it("超出範圍的編號一律當作模型推論", () => {
    // 指向不存在的來源比沒有出處更糟 —— 它看起來像已經查核過
    expect(normalizeSource(5, 4)).toBeNull();
    expect(normalizeSource(0, 4)).toBeNull();
    expect(normalizeSource(-1, 4)).toBeNull();
    expect(normalizeSource(99, 4)).toBeNull();
  });

  it("沒有新聞時任何編號都無效", () => {
    expect(normalizeSource(1, 0)).toBeNull();
  });

  it("非整數與非數值一律為 null", () => {
    expect(normalizeSource(1.5, 4)).toBeNull();
    expect(normalizeSource("2", 4)).toBeNull();
    expect(normalizeSource(null, 4)).toBeNull();
    expect(normalizeSource(undefined, 4)).toBeNull();
    expect(normalizeSource(Number.NaN, 4)).toBeNull();
  });
});

describe("normalizeClaims", () => {
  it("保留文字並驗證出處", () => {
    expect(
      normalizeClaims(
        [
          { text: "有報導根據的事", source: 2 },
          { text: "模型自己推論的事", source: null },
          { text: "指向不存在來源", source: 9 },
        ],
        4,
      ),
    ).toEqual([
      { text: "有報導根據的事", source: 2 },
      { text: "模型自己推論的事", source: null },
      { text: "指向不存在來源", source: null },
    ]);
  });

  it("模型若回傳純字串陣列（舊格式）視為無出處", () => {
    expect(normalizeClaims(["甲", "乙"], 4)).toEqual([
      { text: "甲", source: null },
      { text: "乙", source: null },
    ]);
  });

  it("去除前後空白", () => {
    expect(normalizeClaims([{ text: "  有空白  ", source: 1 }], 4)[0]).toEqual({
      text: "有空白",
      source: 1,
    });
  });

  it("空字串與缺 text 的項目直接剔除", () => {
    expect(normalizeClaims([{ text: "", source: 1 }, { source: 2 }, "   "], 4)).toEqual([]);
  });

  it("非陣列輸入回空陣列，不崩潰", () => {
    expect(normalizeClaims(undefined, 4)).toEqual([]);
    expect(normalizeClaims(null as never, 4)).toEqual([]);
  });
});

describe("sanitizeStocks", () => {
  const ok = { code: "2330", name: "台積電", reason: "先進封裝主力", sector: "晶圓代工" };

  it("保留四個必要欄位齊全的標的，並正規化出處編號", () => {
    expect(sanitizeStocks([{ ...ok, reasonSource: 2 }], 4)).toEqual([
      { ...ok, reasonSource: 2 },
    ]);
  });

  it("缺 name 的那筆被濾掉 —— 它會讓前端在 render 期間丟例外而整頁白屏", () => {
    // openapi 宣告 code/name/reason/sector 全部 required，但模型只是被
    // 「請回 JSON」要求，沒有 responseSchema 約束。少一個 name，
    // queriedStock 的 s.name.trim() 就是 TypeError，而全樹沒有 ErrorBoundary。
    const out = sanitizeStocks([{ code: "2330", reason: "x", sector: "y" }, ok], 4);
    expect(out).toEqual([{ ...ok, reasonSource: null }]);
  });

  it("代號不是四到六位數字的一律濾掉", () => {
    const bad = [
      { ...ok, code: "AAPL" },
      { ...ok, code: "23" },
      { ...ok, code: "1234567" },
      { ...ok, code: "" },
    ];
    expect(sanitizeStocks(bad, 4)).toEqual([]);
  });

  it("null、字串或非物件的元素不會讓整支 API 崩潰", () => {
    expect(sanitizeStocks([null, "2330", 123, undefined, ok], 4)).toEqual([
      { ...ok, reasonSource: null },
    ]);
  });

  it("只有空白的欄位視為缺漏", () => {
    expect(sanitizeStocks([{ ...ok, name: "   " }], 4)).toEqual([]);
  });

  it("輸入不是陣列時回空陣列", () => {
    expect(sanitizeStocks(undefined, 4)).toEqual([]);
    expect(sanitizeStocks({ code: "2330" }, 4)).toEqual([]);
  });
});
