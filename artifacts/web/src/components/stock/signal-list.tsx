import React from 'react';
import { StockDetailResult, Signal } from '@workspace/api-client-react';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, MoveRight } from 'lucide-react';

type Trend = NonNullable<StockDetailResult['trend']>;

const DIRECTION: Record<Signal['direction'], { Icon: typeof TrendingUp; className: string }> = {
  bullish: { Icon: TrendingUp, className: 'text-primary border-primary/30 bg-primary/5' },
  bearish: { Icon: TrendingDown, className: 'text-destructive border-destructive/30 bg-destructive/5' },
  neutral: { Icon: Minus, className: 'text-muted-foreground border-border bg-muted/30' },
};

const TRENDS: Record<Trend, { Icon: typeof ArrowUpRight; label: string; className: string }> = {
  uptrend: { Icon: ArrowUpRight, label: '上升趨勢', className: 'text-primary' },
  downtrend: { Icon: ArrowDownRight, label: '下降趨勢', className: 'text-destructive' },
  range: { Icon: MoveRight, label: '區間整理', className: 'text-muted-foreground' },
};

interface SignalListProps {
  signals?: Signal[];
  trend?: Trend;
  trendBasis?: string;
  /**
   * 是否顯示各項訊號的計算值。
   *
   * 新手視圖關掉：那一段是等寬字的原始數值，寫給會驗算的人看的。
   * 預設為 true —— 既有呼叫端不傳這個 prop 時行為不變。
   */
  showDetails?: boolean;
}

/**
 * 訊號依據與趨勢。
 *
 * 標題刻意不是「AI 推薦原因」—— 這些全部由程式規則算出，不是模型判斷。
 * 而且 Gemini 的呼叫發生在抓取個股資料之前，模型從未看過任何價格數字，
 * 要它列出這些條件必然是幻覺。每一條的 detail 都可以用畫面上的數值驗算。
 *
 * 這些訊號**不進入評分**。評分本來就是未經回測的經驗設定，
 * 再塞進五個同樣未驗證的權重只會讓它更難歸因。
 */
export function SignalList({ signals, trend, trendBasis, showDetails = true }: SignalListProps) {
  // 舊快照沒有這兩個欄位。整塊不渲染，不顯示半截狀態。
  if (!signals && !trend) return null;

  const view = trend ? TRENDS[trend] : null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h4 className="text-sm font-bold text-muted-foreground">訊號依據</h4>
        {view && (
          <span className={`text-sm font-bold flex items-center gap-1 ${view.className}`}>
            <view.Icon className="w-4 h-4" />
            {view.label}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">依規則計算，非模型判斷</span>
      </div>

      {trendBasis && <p className="text-[11px] text-muted-foreground font-mono">{trendBasis}</p>}

      {signals && signals.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {signals.map((s) => {
            // 後端之後會新增方向，而快照沒有任何執行期驗證 ——
            // 查不到就退回中性，不要讓一個沒見過的字串把整張頁面帶下去。
            const d = DIRECTION[s.direction] ?? DIRECTION.neutral;
            return (
              <span
                key={s.key}
                title={s.detail}
                className={`text-xs border rounded px-2 py-1 flex items-center gap-1 ${d.className}`}
              >
                <d.Icon className="w-3 h-3 shrink-0" />
                {s.label}
              </span>
            );
          })}
        </div>
      ) : (
        /* 空陣列代表「沒有任何條件成立」，與「資料缺失」是兩件事，必須講清楚 */
        <p className="text-xs text-muted-foreground">目前沒有任何訊號條件成立</p>
      )}

      {showDetails && signals && signals.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">各項訊號的計算值</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {signals.map((s) => (
              <li key={s.key}>
                {s.label}：{s.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
