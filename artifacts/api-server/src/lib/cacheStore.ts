/**
 * 快取的底層儲存。
 *
 * 抽出這一層是因為執行環境有兩種，而它們對「記憶體」的假設完全相反：
 *
 * - 本機與測試：單一長駐 process，模組層級的 Map 就夠了。
 * - Netlify Functions：每次呼叫可能落在不同實例，冷啟動即清空，
 *   並行的兩個請求也看不到彼此寫入的東西。記憶體快取在這裡等於沒有快取。
 *
 * 把「資料放哪裡」與「以日為單位失效」分開之後，後者的邏輯只需要被測試涵蓋
 * 一次，兩種環境共用；而這一層各自都薄到可以一眼看完。
 */

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** 上限僅為避免長時間執行時無上限成長；超過即淘汰最舊者 */
const DEFAULT_MAX_ENTRIES = 200;

export interface MemoryStore extends CacheStore {
  /** 測試用：確認淘汰確實發生 */
  readonly size: number;
}

export function createMemoryStore(maxEntries = DEFAULT_MAX_ENTRIES): MemoryStore {
  const map = new Map<string, string>();

  return {
    async get(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },

    async set(key, value) {
      // 先刪再設，讓重複寫入的鍵移到插入順序末端（Map 依插入順序迭代）
      map.delete(key);
      map.set(key, value);
      while (map.size > maxEntries) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        map.delete(oldest.value);
      }
    },

    get size() {
      return map.size;
    },
  };
}

interface BlobsLike {
  get(key: string, options: { type: "text" }): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

/**
 * Netlify Blobs 儲存，取不到時退回傳入的替代品。
 *
 * 為什麼要能退回：`getStore()` 只有在 Netlify 的執行環境（含 `netlify dev`）
 * 才拿得到憑證，直接跑 `node dist/index.mjs` 或 vitest 時會拋錯。
 * 讓它安靜地退回記憶體，本機開發與測試才不必為了「雲端才有的東西」而改寫。
 * 退回只影響快取命中率，不影響正確性 —— 快取沒中就是重算一次。
 *
 * 解析結果會被記住（含失敗），避免每個請求都重試一次匯入。
 */
export function createBlobStore(
  name: string,
  fallback: CacheStore = createMemoryStore(),
  onFallback?: (reason: string) => void,
): CacheStore {
  let resolved: BlobsLike | null | undefined;

  async function resolve(): Promise<BlobsLike | null> {
    if (resolved !== undefined) return resolved;
    try {
      const { getStore } = await import("@netlify/blobs");
      resolved = getStore(name) as unknown as BlobsLike;
    } catch (err) {
      resolved = null;
      onFallback?.(err instanceof Error ? err.message : String(err));
    }
    return resolved;
  }

  return {
    async get(key) {
      const store = await resolve();
      if (!store) return fallback.get(key);
      try {
        return await store.get(key, { type: "text" });
      } catch {
        // 讀取失敗當成沒命中即可 —— 快取是最佳化，不是資料來源。
        return null;
      }
    },

    async set(key, value) {
      const store = await resolve();
      if (!store) return fallback.set(key, value);
      try {
        await store.set(key, value);
      } catch {
        // 寫入失敗只是下次不會命中，不該讓整個請求失敗。
      }
    },
  };
}
