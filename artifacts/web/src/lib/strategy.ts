/**
 * 分析週期對應的操作策略類型。
 *
 * 週期在後端已透過 `horizonFactor` 影響停損停利的絕對幅度，這裡只是把
 * 同一個選擇翻成使用者看得懂的說法 —— 少了它，抱 6 個月的計畫會被
 * 當成隔日沖用，而畫面上沒有任何地方點出這個差別。
 */

export interface Strategy {
  /** 策略名稱，例如「波段」 */
  label: string;
  /** 約當持有期間，例如「約 3 個月」 */
  detail: string;
}

const STRATEGIES: Record<string, Strategy> = {
  '1m': { label: '短線', detail: '約 1 個月' },
  '3m': { label: '波段', detail: '約 3 個月' },
  '6m': { label: '中長線', detail: '約 6 個月' },
};

/** 基準週期，與後端 `normalizePeriod` 的預設一致 */
const DEFAULT: Strategy = { label: '波段', detail: '約 3 個月' };

/** 週期缺失或不在規格內時一律以基準週期陳述，不顯示空白標籤 */
export function strategyFor(period?: string | null): Strategy {
  return STRATEGIES[period ?? ''] ?? DEFAULT;
}
