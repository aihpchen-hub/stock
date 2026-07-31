/**
 * 測試用的 localStorage 替身（記憶體實作）。
 *
 * artifacts/web 的 lib/history.ts 與 lib/settings.ts 直接呼叫**全域** localStorage，
 * 而 vitest 跑在 node 環境沒有這個 API。因此本模組在被 import 的當下就把替身
 * 掛上 globalThis —— 測試檔把它排在第一個 import 即可。
 *
 * 為什麼用替身而不是換成 jsdom：只為了幾個 key-value 操作就拉進整套 DOM 實作
 * 並不划算，而且替身能提供 __seed 這種「直接塞入損毀資料」的入口，
 * 那正是容錯路徑唯一測得到的方式。
 *
 * 對應 artifacts/mobile 的 asyncStorageStub —— 兩者的測試輔助介面
 * （__reset / __seed / __keys）刻意保持一致，讓測試檔搬移時不必改寫。
 */
const store = new Map<string, string>();

const localStorageStub = {
  getItem(key: string): string | null {
    return store.has(key) ? (store.get(key) as string) : null;
  },
  setItem(key: string, value: string): void {
    // 真正的 localStorage 一律把值轉成字串，替身也照做，
    // 否則測試會通過但正式環境拿到的型別不同。
    store.set(key, String(value));
  },
  removeItem(key: string): void {
    store.delete(key);
  },
  clear(): void {
    store.clear();
  },
  key(index: number): string | null {
    return [...store.keys()][index] ?? null;
  },
  get length(): number {
    return store.size;
  },
  /** 測試專用：在每個測試前清空，避免互相污染 */
  __reset(): void {
    store.clear();
  },
  /** 測試專用：直接塞入損毀資料，驗證容錯路徑 */
  __seed(key: string, raw: string): void {
    store.set(key, raw);
  },
  __keys(): string[] {
    return [...store.keys()];
  },
};

(globalThis as { localStorage?: unknown }).localStorage = localStorageStub;

export default localStorageStub;
