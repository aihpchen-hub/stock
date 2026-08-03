import React from 'react';
import { StockDetailResult } from '@workspace/api-client-react';
import { CheckCircle2, Clock, XCircle, HelpCircle } from 'lucide-react';

interface AdviceBannerProps {
  advice?: StockDetailResult['advice'];
  currentPrice?: number | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss?: number | null;
  priceAsOf?: string | null;
}

/**
 * 目前操作建議。
 *
 * 這是整張卡片最先該被看到的東西 —— 交易計畫的三個價位在跌破均線時
 * 講的是「假如站回月線之後」，沒有這條橫幅，使用者只會看到三個
 * 彼此打架的數字而不知道現在到底能不能買。
 */
export function AdviceBanner({
  advice,
  currentPrice,
  entryLow,
  entryHigh,
  stopLoss,
  priceAsOf,
}: AdviceBannerProps) {
  // 舊快照沒有這個欄位 —— 整塊不渲染，不顯示半截狀態
  if (!advice) return null;

  const price = currentPrice != null ? currentPrice.toString() : '—';

  const view = {
    can_enter: {
      Icon: CheckCircle2,
      title: '可進場',
      body: `現價 ${price} 落在建議區間 ${entryLow} ~ ${entryHigh} 之間`,
      className: 'bg-primary/10 border-primary/40 text-primary',
    },
    wait_pullback: {
      Icon: Clock,
      title: '等待回檔買點',
      body: `現價 ${price} 已離月線過遠，等回檔至 ${entryLow} ~ ${entryHigh} 再進場`,
      className: 'bg-amber-500/10 border-amber-500/40 text-amber-500',
    },
    wait_breakout: {
      Icon: Clock,
      title: '等待突破買點',
      body: `現價 ${price}，站回 ${entryLow} 之上這份計畫才成立`,
      className: 'bg-amber-500/10 border-amber-500/40 text-amber-500',
    },
    stop_breached: {
      Icon: XCircle,
      title: '已跌破停損，不建議進場',
      body: `現價 ${price} 已低於停損 ${stopLoss}，原計畫的前提不成立`,
      className: 'bg-destructive/10 border-destructive/40 text-destructive',
    },
    insufficient_data: {
      Icon: HelpCircle,
      title: '資料不足，無法給出建議',
      body: '缺少計算交易計畫所需的價格或波動資料',
      className: 'bg-muted border-border text-muted-foreground',
    },
  }[advice.action];

  const { Icon, title, body, className } = view;

  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${className}`}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        <div className="font-bold">{title}</div>
        <div className="text-sm text-foreground/80 break-words">{body}</div>
        {priceAsOf && (
          <div className="text-xs text-muted-foreground">
            以 {priceAsOf} 收盤價判斷，非盤中即時報價
          </div>
        )}
      </div>
    </div>
  );
}
