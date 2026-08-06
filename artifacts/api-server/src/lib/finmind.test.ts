import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchFinMind, fetchFinMindResult } from "./finmind";

/** 只有網路這一層需要替身，其餘都是真實程式碼 */
function stubFetch(impl: () => Promise<Response> | never) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchFinMindResult 區分「抓不到」與「值是零」", () => {
  it("成功時回傳資料列", async () => {
    stubFetch(async () => jsonResponse({ msg: "success", status: 200, data: [{ close: 100 }] }));
    const r = await fetchFinMindResult<{ close: number }>("http://x");
    expect(r).toEqual({ ok: true, rows: [{ close: 100 }] });
  });

  it("成功但沒有 data 欄位時視為空資料，不是失敗", async () => {
    stubFetch(async () => jsonResponse({ msg: "success", status: 200 }));
    const r = await fetchFinMindResult("http://x");
    expect(r).toEqual({ ok: true, rows: [] });
  });

  it("HTTP 402 是額度用盡，必須與空資料分得開", async () => {
    // FinMind 免費層超過額度時回 402。先前這裡回 []，於是
    // 「這檔今天沒有法人買賣超」與「我們沒抓到」在型別上完全相同。
    stubFetch(async () => jsonResponse({ msg: "Requests reach the upper limit", status: 402 }, 402));
    const r = await fetchFinMindResult("http://x");
    expect(r).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("HTTP 429 同樣視為額度用盡", async () => {
    stubFetch(async () => jsonResponse({ msg: "too many requests" }, 429));
    expect(await fetchFinMindResult("http://x")).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("HTTP 200 但內文 status 為 402 也是額度用盡", async () => {
    // FinMind 有時用 200 包一個 402 的內文
    stubFetch(async () => jsonResponse({ msg: "limit", status: 402 }));
    expect(await fetchFinMindResult("http://x")).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("其他 HTTP 錯誤標為 http", async () => {
    stubFetch(async () => jsonResponse({}, 500));
    expect(await fetchFinMindResult("http://x")).toEqual({ ok: false, reason: "http" });
  });

  it("內文 status 非 200 且非額度問題標為 http", async () => {
    stubFetch(async () => jsonResponse({ msg: "bad dataset", status: 400 }));
    expect(await fetchFinMindResult("http://x")).toEqual({ ok: false, reason: "http" });
  });

  it("連線失敗或逾時標為 network，不讓例外冒泡成整支 API 的 500", async () => {
    stubFetch(() => {
      throw new Error("fetch failed");
    });
    expect(await fetchFinMindResult("http://x")).toEqual({ ok: false, reason: "network" });
  });

  it("回應不是合法 JSON 時標為 http，而不是整支 API 崩潰", async () => {
    stubFetch(async () => new Response("<html>502</html>", { status: 200 }));
    expect(await fetchFinMindResult("http://x")).toEqual({ ok: false, reason: "http" });
  });
});

describe("fetchFinMind 的相容包裝", () => {
  it("成功時直接給資料列", async () => {
    stubFetch(async () => jsonResponse({ msg: "ok", status: 200, data: [1, 2] }));
    expect(await fetchFinMind<number>("http://x")).toEqual([1, 2]);
  });

  it("任何失敗都退化成空陣列 —— 呼叫端以「資料不足」處理", async () => {
    stubFetch(async () => jsonResponse({ status: 402 }, 402));
    expect(await fetchFinMind("http://x")).toEqual([]);
  });
});
