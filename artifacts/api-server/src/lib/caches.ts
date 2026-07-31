/**
 * 全站共用的快取儲存。
 *
 * 集中在這裡而不是各路由自己建：Blobs store 的名稱一旦分歧就等於各存各的，
 * 而且「退回記憶體」的警告只該出現一次。型別留給呼叫端指定 —— 這一層不需要
 * 知道存的是分析結果還是個股資料。
 */

import { createBlobStore } from "./cacheStore";
import { createDailyCache, type DailyCache } from "./dailyCache";
import { logger } from "./logger";

/** 各種快取共用同一個 store；鍵已帶 `analysis|` / `stock|` 前綴，不會相撞 */
const BLOB_STORE_NAME = "daily-cache";

let warned = false;

const sharedStore = createBlobStore(BLOB_STORE_NAME, undefined, (reason) => {
  if (warned) return;
  warned = true;
  // 本機開發時這是正常狀態，不是錯誤；但部署後若出現就代表每個實例各存各的，
  // Gemini 額度會被重複查詢吃掉 —— 那必須看得到。
  logger.warn(
    { reason },
    "Netlify Blobs unavailable; falling back to per-instance in-memory cache",
  );
});

/** 取得一份以日為單位的快取，與其他呼叫者共用同一個底層 store */
export function dailyCacheFor<T>(): DailyCache<T> {
  return createDailyCache<T>(sharedStore);
}

/**
 * 每日配額的計數也放同一個 store —— 鍵帶 `quota|` 前綴，不會與快取相撞。
 *
 * 與快取共用是刻意的：兩者都必須跨實例共享才有意義，而分開兩個 store
 * 只會多一組要記得設定的名稱。
 */
export const quotaStore = sharedStore;
