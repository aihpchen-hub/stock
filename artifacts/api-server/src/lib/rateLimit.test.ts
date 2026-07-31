import { describe, expect, it } from "vitest";

import { createMemoryStore } from "./cacheStore";
import { clientIdentity, consumeDailyQuota } from "./rateLimit";

describe("consumeDailyQuota", () => {
  it("在上限內逐次放行並累計", async () => {
    const store = createMemoryStore();
    expect(await consumeDailyQuota(store, "ip", "d", 3)).toEqual({
      allowed: true,
      used: 1,
      limit: 3,
    });
    expect(await consumeDailyQuota(store, "ip", "d", 3)).toMatchObject({ allowed: true, used: 2 });
    expect(await consumeDailyQuota(store, "ip", "d", 3)).toMatchObject({ allowed: true, used: 3 });
  });

  it("超過上限後擋下", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) await consumeDailyQuota(store, "ip", "d", 3);
    expect(await consumeDailyQuota(store, "ip", "d", 3)).toMatchObject({ allowed: false });
  });

  it("被擋下時不再累加計數", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) await consumeDailyQuota(store, "ip", "d", 3);
    await consumeDailyQuota(store, "ip", "d", 3);
    const blocked = await consumeDailyQuota(store, "ip", "d", 3);
    // 持續被擋不該讓數字無止境膨脹
    expect(blocked.used).toBe(3);
  });

  it("不同 IP 各自計算", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) await consumeDailyQuota(store, "a", "d", 3);
    expect(await consumeDailyQuota(store, "b", "d", 3)).toMatchObject({ allowed: true, used: 1 });
  });

  it("換日重新計算", async () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) await consumeDailyQuota(store, "ip", "2026-07-30", 3);
    expect(await consumeDailyQuota(store, "ip", "2026-07-31", 3)).toMatchObject({
      allowed: true,
      used: 1,
    });
  });

  it("計數資料損毀時放行而非把人鎖在門外", async () => {
    const store = createMemoryStore();
    await store.set("quota|d|ip", "{{{ 壞掉");
    expect(await consumeDailyQuota(store, "ip", "d", 3)).toMatchObject({ allowed: true, used: 1 });
  });
});

describe("clientIdentity", () => {
  it("優先採用 Netlify 提供的來源 IP", () => {
    expect(
      clientIdentity({ "x-nf-client-connection-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }),
    ).toBe("1.1.1.1");
  });

  it("其次取 x-forwarded-for 的第一段", () => {
    expect(clientIdentity({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })).toBe("2.2.2.2");
  });

  it("都沒有時退回 Express 的 req.ip", () => {
    expect(clientIdentity({}, "127.0.0.1")).toBe("127.0.0.1");
  });

  it("完全無法辨識時給一個固定值而非 undefined", () => {
    // 回 undefined 會讓所有無法辨識的來源共用「undefined」這個鍵，
    // 那與回一個固定字串效果相同，但型別上更容易出錯
    expect(clientIdentity({})).toBe("unknown");
  });

  it("忽略空白字串的標頭", () => {
    expect(clientIdentity({ "x-nf-client-connection-ip": "   " }, "127.0.0.1")).toBe("127.0.0.1");
  });
});
