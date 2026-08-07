import { afterEach, describe, expect, it, vi } from "vitest";

import { isStockCode, resolveStock } from "./stockInfo";

/**
 * 測試共用同一個模組層的記憶體快取（Blobs 在測試環境不可用），
 * 因此每個案例用不同的代號，避免互相命中。
 */
function stubFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function ok(rows: unknown[]): Response {
  return new Response(JSON.stringify({ msg: "success", status: 200, data: rows }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const ROW = {
  stock_id: "2330",
  stock_name: "台積電",
  industry_category: "半導體業",
  type: "twse",
};

afterEach(() => vi.unstubAllGlobals());

describe("isStockCode", () => {
  it("四到六位純數字才算代號", () => {
    expect(isStockCode("2330")).toBe(true);
    expect(isStockCode("00878")).toBe(true);
    expect(isStockCode("123")).toBe(false);
    expect(isStockCode("1234567")).toBe(false);
    expect(isStockCode("AAPL")).toBe(false);
  });
});

describe("resolveStock 的日快取", () => {
  it("第一次抓、第二次直接命中快取", async () => {
    // 公司簡稱與產業別是全系統最靜態的資料（一年變動幾次），
    // 卻是唯一每次請求都重抓的 —— 一次分析五檔就是五個請求。
    const spy = stubFetch(async () => ok([{ ...ROW, stock_id: "1101" }]));

    const first = await resolveStock("1101");
    const second = await resolveStock("1101");

    expect(first?.stock_name).toBe("台積電");
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("不同代號各自查，不會互相命中", async () => {
    const spy = stubFetch(async () => ok([{ ...ROW, stock_id: "1102" }]));
    await resolveStock("1102");
    await resolveStock("1103");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("查不到時回 null", async () => {
    stubFetch(async () => ok([]));
    expect(await resolveStock("9998")).toBeNull();
  });

  it("抓取失敗時回 null，而且不快取 —— 下次要能重試", async () => {
    const spy = stubFetch(async () => new Response("nope", { status: 500 }));
    expect(await resolveStock("9997")).toBeNull();
    expect(await resolveStock("9997")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("連線失敗不會冒泡成例外", async () => {
    stubFetch(() => {
      throw new Error("fetch failed");
    });
    await expect(resolveStock("9996")).resolves.toBeNull();
  });

  it("回傳的列缺 stock_name 時視為查不到", async () => {
    stubFetch(async () => ok([{ stock_id: "9995", industry_category: "x", type: "twse" }]));
    expect(await resolveStock("9995")).toBeNull();
  });
});
