import { describe, expect, it } from "vitest";

import { createMemoryStore } from "./cacheStore";
import {
  analysisCacheKey,
  createDailyCache,
  marketCacheKey,
  stockCacheKey,
  today,
} from "./dailyCache";

/** 每個測試給一份乾淨的儲存，避免互相污染 */
const freshCache = <T>() => createDailyCache<T>(createMemoryStore());

describe("createDailyCache", () => {
  it("同日同鍵取得同一份資料", async () => {
    const cache = freshCache<string>();
    await cache.set("k", "2026-07-30", "value");
    expect(await cache.get("k", "2026-07-30")).toBe("value");
  });

  it("未寫入過回傳 null", async () => {
    expect(await freshCache<string>().get("k", "2026-07-30")).toBeNull();
  });

  it("換日即失效", async () => {
    const cache = freshCache<string>();
    await cache.set("k", "2026-07-30", "value");
    expect(await cache.get("k", "2026-07-31")).toBeNull();
  });

  it("隔日寫入覆蓋同一個鍵，不會留下舊日資料", async () => {
    const store = createMemoryStore();
    const cache = createDailyCache<string>(store);
    await cache.set("k", "2026-07-30", "舊");
    await cache.set("k", "2026-07-31", "新");
    expect(store.size).toBe(1);
    expect(await cache.get("k", "2026-07-31")).toBe("新");
    expect(await cache.get("k", "2026-07-30")).toBeNull();
  });

  it("保存物件而非只有字串", async () => {
    const cache = freshCache<{ a: number[]; b: string }>();
    const value = { a: [1, 2, 3], b: "x" };
    await cache.set("k", "d", value);
    expect(await cache.get("k", "d")).toEqual(value);
  });

  it("資料損毀時視為沒命中而非拋錯", async () => {
    const store = createMemoryStore();
    await store.set("k", "{{{ 不是合法 JSON");
    expect(await createDailyCache<string>(store).get("k", "d")).toBeNull();
  });

  it("內容不是預期結構時也視為沒命中", async () => {
    const store = createMemoryStore();
    await store.set("k", '"只是一個字串"');
    expect(await createDailyCache<string>(store).get("k", "d")).toBeNull();
  });
});

describe("analysisCacheKey", () => {
  it("關鍵字與週期共同構成鍵", () => {
    expect(analysisCacheKey("AI散熱", "3m")).not.toBe(analysisCacheKey("AI散熱", "6m"));
  });

  it("忽略前後空白與大小寫差異", () => {
    expect(analysisCacheKey("  CPO  ", "3m")).toBe(analysisCacheKey("cpo", "3m"));
  });
});

describe("stockCacheKey", () => {
  it("代號與週期共同構成鍵", () => {
    expect(stockCacheKey("2330", "1m")).not.toBe(stockCacheKey("2330", "6m"));
  });

  it("與分析結果不會撞鍵", () => {
    expect(stockCacheKey("2330", "3m")).not.toBe(analysisCacheKey("2330", "3m"));
  });

  it("帶規則版本前綴 —— 部署當天不會讀到缺少新欄位的舊 payload", () => {
    // 驗證「有版本前綴」這個不變量，而非某個特定版號：寫死版號會讓每次
    // 加欄位都必須順手改一次測試，而那個改動本身不帶任何驗證價值。
    expect(stockCacheKey("2330", "3m")).toMatch(/\|v\d+\|/);
  });
});

describe("marketCacheKey", () => {
  it("不帶代號與週期 —— 大盤脈絡對所有標的與所有持有期都是同一份", () => {
    expect(marketCacheKey()).toBe(marketCacheKey());
    expect(marketCacheKey()).not.toContain("3m");
  });

  it("與個股、分析結果都不會撞鍵", () => {
    expect(marketCacheKey()).not.toBe(stockCacheKey("TAIEX", "3m"));
    expect(marketCacheKey()).not.toBe(analysisCacheKey("TAIEX", "3m"));
  });

  it("帶版本前綴，理由與個股快取相同", () => {
    expect(marketCacheKey()).toMatch(/\|v\d+\|/);
  });
});

describe("today", () => {
  it("輸出 YYYY-MM-DD 並補零", () => {
    expect(today(new Date("2026-01-05T04:00:00Z"))).toBe("2026-01-05");
  });

  it("採台北日期而非伺服器本地日期", () => {
    // 正式環境是 Netlify 的無伺服器函式，時區是 UTC。用伺服器本地日期的話，
    // 「今天」會在台北時間早上八點翻新 —— 收盤後寫進去的快取撐不到隔天早上，
    // 而早上八點到午夜之間的使用者拿到的是「昨天」那一份。
    // 台灣沒有日光節約，UTC+8 是精確的。
    expect(today(new Date("2026-07-31T16:30:00Z"))).toBe("2026-08-01"); // 台北 8/1 00:30
    expect(today(new Date("2026-07-31T15:30:00Z"))).toBe("2026-07-31"); // 台北 7/31 23:30
  });

  it("台北早上八點仍是同一天，不會提前翻日", () => {
    // 這正是先前的缺陷：UTC 00:00 = 台北 08:00，快取在開盤前就整批失效
    expect(today(new Date("2026-08-01T00:00:00Z"))).toBe("2026-08-01"); // 台北 8/1 08:00
    expect(today(new Date("2026-08-01T23:59:00Z"))).toBe("2026-08-02"); // 台北 8/2 07:59
  });
});
