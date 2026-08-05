import type {
  AnalyzeRequestPeriod,
  AnalyzeResult,
  AnalyzeResultSentiment,
  StockDetailResult,
  StockDetailResultEvSignal,
} from '@workspace/api-client-react';

import { queriedIdentity } from './queriedStock';

// ─── Keys ─────────────────────────────────────────────────────────────────────
// Two-layer design: the list renders from the index alone, so opening the app
// never parses every stored snapshot.
const INDEX_KEY = 'history_index_v1';
const SNAPSHOT_PREFIX = 'history_snapshot_';

export const MAX_ENTRIES = 50;

// ─── Types ────────────────────────────────────────────────────────────────────
export type AnalysisSnapshot = {
  id: string;
  createdAt: number;
  keyword: string;
  period: AnalyzeRequestPeriod;
  analysis: AnalyzeResult;
  /** Keyed by stock code. Stocks whose detail query failed are simply absent. */
  stockDetails: Record<string, StockDetailResult>;
};

export type HistoryMeta = {
  id: string;
  createdAt: number;
  keyword: string;
  period: AnalyzeRequestPeriod;
  sentiment: AnalyzeResultSentiment;
  stockCount: number;
  /** Highest-E(V) stock in the snapshot, surfaced directly in the list. */
  topCode: string | null;
  topName: string | null;
  topEv: number | null;
  topSignal: StockDetailResultEvSignal | null;
  /** 選用：舊快照建立時尚未記錄此欄，讀回時會是 undefined */
  topPrice?: number | null;
  /**
   * 使用者查的那一檔。查產業關鍵字時為 null。
   *
   * 與 top* 是兩回事：紀錄列印的「領先標的」是期望值最高的那檔，查 5439 時
   * 那通常是別人。少了這兩個欄位，一筆「5439」的紀錄旁邊寫著「領先標的:
   * 台燿」，回頭看認不出這次查的是什麼。
   *
   * 選用：舊快照建立時尚未記錄此欄，讀回時會是 undefined。
   */
  queriedCode?: string | null;
  queriedName?: string | null;
};

function snapshotKey(id: string) {
  return SNAPSHOT_PREFIX + id;
}

export function makeSnapshotId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Meta derivation ──────────────────────────────────────────────────────────
export function buildMeta(snapshot: AnalysisSnapshot): HistoryMeta {
  let topCode: string | null = null;
  let topName: string | null = null;
  let topEv: number | null = null;
  let topSignal: StockDetailResultEvSignal | null = null;
  let topPrice: number | null = null;

  for (const stock of snapshot.analysis.stocks) {
    const detail = snapshot.stockDetails[stock.code];
    if (!detail || detail.ev == null) continue;
    if (topEv === null || detail.ev > topEv) {
      topEv = detail.ev;
      topCode = stock.code;
      topName = stock.name;
      topSignal = detail.evSignal ?? null;
      topPrice = detail.currentPrice ?? null;
    }
  }

  const queried = queriedIdentity(
    snapshot.keyword,
    snapshot.analysis.stocks,
    snapshot.stockDetails,
  );

  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    keyword: snapshot.keyword,
    period: snapshot.period,
    sentiment: snapshot.analysis.sentiment,
    stockCount: snapshot.analysis.stocks.length,
    topCode,
    topName,
    topEv,
    topSignal,
    topPrice,
    queriedCode: queried?.code ?? null,
    queriedName: queried?.name ?? null,
  };
}

function isMeta(value: unknown): value is HistoryMeta {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<HistoryMeta>;
  return typeof m.id === 'string' && typeof m.createdAt === 'number' && typeof m.keyword === 'string';
}

// ─── Read ─────────────────────────────────────────────────────────────────────
/** Never throws. A corrupt index is treated as empty rather than breaking the screen. */
export async function loadIndex(): Promise<HistoryMeta[]> {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMeta).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Returns null when missing or unparseable, so callers can show a friendly error. */
export async function loadSnapshot(id: string): Promise<AnalysisSnapshot | null> {
  try {
    const raw = localStorage.getItem(snapshotKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisSnapshot;
    if (!parsed || typeof parsed.id !== 'string' || !parsed.analysis) return null;
    if (!parsed.stockDetails) parsed.stockDetails = {};
    return parsed;
  } catch {
    return null;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────
/** Saves the snapshot, trims to MAX_ENTRIES, and returns the updated index. */
export async function save(snapshot: AnalysisSnapshot): Promise<HistoryMeta[]> {
  const index = await loadIndex();
  const meta = buildMeta(snapshot);
  const next = [meta, ...index.filter((entry) => entry.id !== meta.id)];

  const kept = next.slice(0, MAX_ENTRIES);
  const overflow = next.slice(MAX_ENTRIES);

  localStorage.setItem(snapshotKey(snapshot.id), JSON.stringify(snapshot));
  localStorage.setItem(INDEX_KEY, JSON.stringify(kept));
  if (overflow.length > 0) {
    overflow.forEach(entry => localStorage.removeItem(snapshotKey(entry.id)));
  }
  return kept;
}

export async function remove(id: string): Promise<HistoryMeta[]> {
  const index = await loadIndex();
  const kept = index.filter((entry) => entry.id !== id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(kept));
  localStorage.removeItem(snapshotKey(id));
  return kept;
}

export async function clearAll(): Promise<void> {
  const index = await loadIndex();
  localStorage.removeItem(INDEX_KEY);
  index.forEach(entry => localStorage.removeItem(snapshotKey(entry.id)));
}

// ─── Display helpers ──────────────────────────────────────────────────────────
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Today → HH:MM, yesterday → 昨天, older → MM/DD */
export function formatHistoryTime(createdAt: number, now: number = Date.now()): string {
  const then = new Date(createdAt);
  const today = new Date(now);

  if (isSameDay(then, today)) {
    const hh = String(then.getHours()).padStart(2, '0');
    const mm = String(then.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(then, yesterday)) return '昨天';

  const month = String(then.getMonth() + 1).padStart(2, '0');
  const day = String(then.getDate()).padStart(2, '0');
  return `${month}/${day}`;
}
