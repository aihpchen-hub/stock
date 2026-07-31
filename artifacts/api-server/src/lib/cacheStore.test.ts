import { describe, expect, it, vi } from "vitest";

import { createBlobStore, createMemoryStore } from "./cacheStore";

describe("createMemoryStore", () => {
  it("寫入後讀得回來", async () => {
    const store = createMemoryStore();
    await store.set("k", "v");
    expect(await store.get("k")).toBe("v");
  });

  it("未寫入過回傳 null", async () => {
    expect(await createMemoryStore().get("nope")).toBeNull();
  });

  it("超過上限時淘汰最舊的項目", async () => {
    const store = createMemoryStore(2);
    await store.set("a", "1");
    await store.set("b", "2");
    await store.set("c", "3");
    expect(store.size).toBe(2);
    expect(await store.get("a")).toBeNull(); // 最舊者被淘汰
    expect(await store.get("b")).toBe("2");
    expect(await store.get("c")).toBe("3");
  });

  it("重複寫入同一鍵不會使它被當成最舊者淘汰", async () => {
    const store = createMemoryStore(2);
    await store.set("a", "1");
    await store.set("b", "2");
    await store.set("a", "10"); // a 重新寫入，應移到末端
    await store.set("c", "3"); // 此時該淘汰 b
    expect(await store.get("a")).toBe("10");
    expect(await store.get("b")).toBeNull();
  });
});

describe("createBlobStore", () => {
  /**
   * 測試環境沒有 Netlify 的憑證，`getStore()` 必定失敗 —— 這正是本機與 CI
   * 會走到的路徑，因此這幾個測試驗的就是「拿不到雲端儲存時仍然可用」。
   */
  it("取不到 Blobs 時退回替代儲存，功能不受影響", async () => {
    const fallback = createMemoryStore();
    const store = createBlobStore("test-store", fallback);

    await store.set("k", "v");
    expect(await store.get("k")).toBe("v");
    expect(await fallback.get("k")).toBe("v");
  });

  it("退回時回報原因，且只回報一次", async () => {
    const onFallback = vi.fn();
    const store = createBlobStore("test-store", createMemoryStore(), onFallback);

    await store.set("a", "1");
    await store.get("a");
    await store.set("b", "2");

    // 解析結果會被記住，不該每個請求都重試一次匯入
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(typeof onFallback.mock.calls[0]?.[0]).toBe("string");
  });
});
