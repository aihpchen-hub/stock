import { describe, expect, it } from "vitest";

import { normalizeClaims, normalizeSource } from "./analyze";

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
