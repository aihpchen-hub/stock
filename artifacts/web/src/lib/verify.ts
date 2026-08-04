/**
 * 把存下來的分析快照轉成前瞻驗證請求。
 *
 * 這是目前唯一能檢驗那張未經回測的機率表的方法：計畫在當時就存下來了，
 * 事後只需要去對答案，沒有回測常見的選股偏誤與過度配適問題。代價是要等。
 */

import type { AnalysisSnapshot, HistoryMeta } from './history';
import { loadSnapshot } from './history';
import type { VerifyOutcomeItem } from '@workspace/api-client-react';

/**
 * 各週期至少要經過幾個日曆日才值得驗證。
 *
 * 太早去對答案，絕大多數都還是「仍持有」，除了消耗額度沒有意義。
 * 門檻必須隨週期走：計畫的失效期限是 10／20／30 個交易日（見 lib/advice 的
 * EXPIRY_TRADING_DAYS），一份 6m 計畫存五個交易日就去問，幾乎必然回
 * 「仍持有」或「未進場」—— 使用者第一次用就拿到一個沒有結論的畫面，
 * 很容易就不再點了。先前固定七個日曆日，對 1m 合理，對 6m 太短。
 *
 * 取各週期失效期限的一半，再換算成日曆日（交易日 × 7/5）：
 *   1m：10 個交易日 → 一半 5 → 7 個日曆日
 *   3m：20 個交易日 → 一半 10 → 14 個日曆日
 *   6m：30 個交易日 → 一半 15 → 21 個日曆日
 * 「一半」是經驗值，只影響何時開始檢查，不影響任何判定結果 ——
 * 因此不像機率表那樣需要驗證。
 */
const MIN_CALENDAR_DAYS: Record<string, number> = { '1m': 7, '3m': 14, '6m': 21 };

/** 週期缺失或認不得時採用的基準，與後端 normalizePeriod 一致 */
const DEFAULT_PERIOD = '3m';

const DAY_MS = 24 * 60 * 60 * 1000;

/** epoch → YYYY-MM-DD（本地時區，與使用者看到的日期一致） */
export function toDateKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 這筆紀錄是否已經舊到值得驗證 */
export function isRipe(
  createdAt: number,
  period: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const days = MIN_CALENDAR_DAYS[period ?? ''] ?? MIN_CALENDAR_DAYS[DEFAULT_PERIOD]!;
  return now - createdAt >= days * DAY_MS;
}

/** 快照裡沒有 ruleVersion 欄位者，是規則第一版留下的 */
export const LEGACY_RULE_VERSION = 1;

export interface VersionedItem {
  item: VerifyOutcomeItem;
  ruleVersion: number;
}

export interface VerifyGroup {
  ruleVersion: number;
  items: VerifyOutcomeItem[];
}

/**
 * 從單一快照取出可驗證的計畫，並保留各筆是哪一套規則算出來的。
 *
 * 缺少任一價位就跳過 —— 當初就沒有完整計畫的標的，事後無從驗證，
 * 硬要補一個推估價位等於偽造當時的判斷。
 */
export function versionedItemsFromSnapshot(snapshot: AnalysisSnapshot): VersionedItem[] {
  const from = toDateKey(snapshot.createdAt);
  const items: VersionedItem[] = [];

  for (const stock of snapshot.analysis.stocks) {
    const d = snapshot.stockDetails[stock.code];
    if (!d) continue;
    const { entryLow, entryHigh, stopLoss, takeProfit } = d;
    if (entryLow == null || entryHigh == null || stopLoss == null || takeProfit == null) continue;
    items.push({
      item: { code: stock.code, from, entryLow, entryHigh, stopLoss, takeProfit },
      ruleVersion: d.ruleVersion ?? LEGACY_RULE_VERSION,
    });
  }

  return items;
}

/** 不需要區分版本時的既有介面 */
export function itemsFromSnapshot(snapshot: AnalysisSnapshot): VerifyOutcomeItem[] {
  return versionedItemsFromSnapshot(snapshot).map((v) => v.item);
}

/**
 * 讀取所有夠舊的快照並組出請求。
 *
 * 只讀夠舊的那些：索引裡有 50 筆，全部讀回來解析很浪費，而不夠舊的本來就不會有結論。
 */
export async function buildVerifyItems(
  index: HistoryMeta[],
  now: number = Date.now(),
): Promise<VerifyOutcomeItem[]> {
  const ripe = index.filter((entry) => isRipe(entry.createdAt, entry.period, now));
  const snapshots = await Promise.all(ripe.map((entry) => loadSnapshot(entry.id)));
  return snapshots.flatMap((snapshot) => (snapshot ? itemsFromSnapshot(snapshot) : []));
}

/**
 * 讀取所有夠舊的快照，依規則版本分組。
 *
 * 分組的理由：規則改版會改變進場區與停損停利，兩套規則的結果混進同一個
 * 達標率之後，數字看起來仍然正常，卻已經量不到任何一套規則的真實表現。
 */
export async function buildVerifyGroups(
  index: HistoryMeta[],
  now: number = Date.now(),
): Promise<VerifyGroup[]> {
  const ripe = index.filter((entry) => isRipe(entry.createdAt, entry.period, now));
  const snapshots = await Promise.all(ripe.map((entry) => loadSnapshot(entry.id)));

  const byVersion = new Map<number, VerifyOutcomeItem[]>();
  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    for (const { item, ruleVersion } of versionedItemsFromSnapshot(snapshot)) {
      const list = byVersion.get(ruleVersion) ?? [];
      list.push(item);
      byVersion.set(ruleVersion, list);
    }
  }

  return [...byVersion.entries()]
    .map(([ruleVersion, items]) => ({ ruleVersion, items }))
    .sort((a, b) => b.ruleVersion - a.ruleVersion);
}

/** 各判定的顯示文字 */
export const OUTCOME_LABEL: Record<string, string> = {
  target: '達標',
  stop: '停損',
  ambiguous: '同日觸及兩者',
  open: '仍持有',
  no_entry: '未進場',
  unknown: '資料不足',
};
