/**
 * 前瞻驗證結果的存放層。
 *
 * 先前結果只存在 `useState` 裡，離開頁面就消失 —— 使用者每次都要重按
 * 一次「對答案」，而這個功能的價值來自累積。存下來之後還有第二個用途：
 * 分析頁的卡片可以把該規則版本的實際達標率印在 E(V) 旁邊。E(V) 是由一張
 * 未經回測的機率表算出來的，而前瞻驗證是唯一能校正那個印象的東西 ——
 * 宣稱與檢驗必須放在同一個畫面上，那才是這個功能真正的位置。
 *
 * 讀取一律不丟例外 —— 整個 app 沒有 ErrorBoundary，一個壞掉的字串
 * 會把整張頁面帶下去。壞掉就當作沒存過。
 */

import type { VerifyOutcomesResult } from '@workspace/api-client-react';

const KEY = 'verify_results_v1';

export interface StoredVerify {
  ruleVersion: number;
  tally: VerifyOutcomesResult['tally'];
  /** 這份結果是什麼時候跑出來的，畫面要標明它不是即時的 */
  verifiedAt: number;
}

function isStored(value: unknown): value is StoredVerify {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredVerify>;
  return typeof v.ruleVersion === 'number' && typeof v.verifiedAt === 'number' && Boolean(v.tally);
}

export function saveVerify(summaries: StoredVerify[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(summaries));
  } catch {
    // 配額滿或隱私模式 —— 存不下就算了，驗證結果不是非有不可的資料，
    // 為了它讓「對答案」整個失敗並不划算。
  }
}

/**
 * 清掉存下來的驗證結果。
 *
 * 必須與清除查詢紀錄綁在一起：那批快照是這份統計唯一的輸入。少了這個，
 * 使用者清完紀錄之後首頁的「前瞻驗證」整塊會消失（hasRipeHistory 變 false），
 * 但每張個股卡片仍印著「這套規則（v3）目前實測：達標率 62.5%（已結案 8 筆）」
 * —— 那 8 筆已經不存在、無法重驗，UI 上也沒有任何路徑可以清掉它。
 */
export function clearVerify(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 隱私模式讀寫都會丟，忽略即可
  }
}

export function loadVerify(): StoredVerify[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 逐筆過濾而非整份丟棄：一筆形狀不對不該讓其他版本的結果一起消失
    return parsed.filter(isStored);
  } catch {
    return [];
  }
}

/**
 * 取指定規則版本的結果。
 *
 * 刻意不做「找不到就回最新版」的退讓：不同規則算出來的進場區與停損停利
 * 不同，拿別版的命中率頂替，數字看起來仍然正常卻已經量不到任何一套規則 ——
 * 那正是 buildVerifyGroups 分組要避免的同一件事。
 */
export function latestFor(summaries: StoredVerify[], ruleVersion: number): StoredVerify | null {
  return summaries.find((s) => s.ruleVersion === ruleVersion) ?? null;
}
