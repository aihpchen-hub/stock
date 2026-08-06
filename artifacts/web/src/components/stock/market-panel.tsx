import React from 'react';
import { StockDetailResult } from '@workspace/api-client-react';
import { TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import type { GroupRank } from '@/lib/groupStrength';
import { formatSignedPct } from '@/lib/format';

interface MarketPanelProps {
  returns?: StockDetailResult['returns'];
  relativeStrength?: StockDetailResult['relativeStrength'];
  market?: StockDetailResult['market'];
  groupRank?: GroupRank | null;
}

/** 四捨五入後為零時不帶正負號 —— 先前 (-0.04).toFixed(1) 會印出「-0.0%」
    並配上紅色下跌箭頭，而那其實是打平 */
const pct = (v: number | null | undefined) => formatSignedPct(v, 1);

/**
 * 相對強弱：對大盤、對同族群。
 *
 * 少了這一塊，「上升趨勢」這個結論沒有基準 —— 大盤同期漲 15% 而個股漲 8%
 * 時畫面照樣寫上升趨勢，但它其實輸給大盤。大多頭時幾乎每檔都站上雙均線、
 * 每檔都拿高分，那是 beta 不是 alpha。
 *
 * 這些數值只做顯示，不進評分（與 SignalList 同一個決定）。
 */
export function MarketPanel({ returns, relativeStrength, market, groupRank }: MarketPanelProps) {
  // 大盤抓不到時整塊不渲染，不顯示半截狀態
  if (!market || !relativeStrength) return null;

  const rs20 = relativeStrength.d20;
  const beating = rs20 != null && rs20 > 0;

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">相對強弱（20 日）</span>
        {market.asOf && (
          <span className="text-[11px] text-muted-foreground font-mono">大盤截至 {market.asOf}</span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground shrink-0">個股 / 大盤</span>
        <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {pct(returns?.d20)} / {pct(market.return20d)}
        </span>
        {rs20 != null && (
          <span
            className={`font-mono font-bold text-sm shrink-0 flex items-center gap-1 ${
              beating ? 'text-up' : 'text-down'
            }`}
          >
            {beating ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {pct(rs20)}
          </span>
        )}
      </div>

      {groupRank && groupRank.total > 1 && (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">同族群排名</span>
          <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
          <span className="font-mono font-medium shrink-0">
            第 {groupRank.rank} / {groupRank.total} 強
          </span>
          {groupRank.leader && <span className="text-xs text-up shrink-0">▲ 族群最強</span>}
          {groupRank.laggard && <span className="text-xs text-down shrink-0">▼ 族群最弱</span>}
        </div>
      )}

      {/* 系統性風險：大盤跌破雙均線時，同一批標的的停損會同時被觸發 ——
          畫面上「分散五檔」看起來是保護，在這種時候並不是。 */}
      {market.maSignal === 'below_both' && (
        <div className="text-xs text-amber-500/90 bg-amber-500/10 p-2 rounded flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            大盤已跌破雙均線。此時個股停損被觸發的機率上升，且同一批標的會同時發生 ——
            分散持有在系統性下跌時不構成保護。
          </span>
        </div>
      )}

      {/* 收合而非刪除：「不計入評分」是誠實的宣告，但誠實不等於要一直印在臉上 */}
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none">相對強弱怎麼算的</summary>
        <p className="mt-1 leading-relaxed">
          相對強弱為個股報酬減大盤同期報酬（百分點），依規則計算，不計入評分。
        </p>
      </details>
    </div>
  );
}
