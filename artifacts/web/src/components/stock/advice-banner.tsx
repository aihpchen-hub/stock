import React from 'react';
import { StockDetailResult } from '@workspace/api-client-react';
import { CheckCircle2, Clock, XCircle, HelpCircle } from 'lucide-react';
import { priceStaleness } from '@/lib/staleness';

interface AdviceBannerProps {
  advice?: StockDetailResult['advice'];
  currentPrice?: number | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss?: number | null;
  priceAsOf?: string | null;
  /** 注入時鐘，預設為現在。抽成 prop 才能測跨連假的顯示 */
  now?: Date;
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
  now = new Date(),
}: AdviceBannerProps) {
  // 舊快照沒有這個欄位，但呼叫端（stock-card）已改為以 deriveAdvice 補算，
  // 正常情況下必定有值。這裡保留防禦性判斷 —— 缺值時整塊不渲染，不顯示半截狀態。
  if (!advice) return null;

  const price = currentPrice != null ? currentPrice.toString() : '—';
  const low = entryLow != null ? entryLow.toString() : '—';
  const high = entryHigh != null ? entryHigh.toString() : '—';
  const stop = stopLoss != null ? stopLoss.toString() : '—';

  /**
   * 距離進場區還有多少百分比。
   *
   * 少了它，「等待突破」把兩種完全不同的處境寫成同一句話：
   * 差 0.15%（明天就可能觸發）與差 9.5%（要先漲一成）都只寫「站回 X 之上」。
   * 投資人會用這個數字決定要不要繼續盯這檔。
   */
  const gapTo = (target: number | null | undefined): string => {
    if (currentPrice == null || currentPrice <= 0 || target == null) return '';
    const pct = ((target - currentPrice) / currentPrice) * 100;
    if (!Number.isFinite(pct)) return '';
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  const upGap = gapTo(entryLow);
  const downGap = gapTo(entryHigh);

  const view = {
    can_enter: {
      Icon: CheckCircle2,
      title: '可進場',
      body: `現價 ${price} 落在建議區間 ${low} ~ ${high} 之間`,
      className: 'bg-primary/10 border-primary/40 text-primary',
    },
    wait_pullback: {
      Icon: Clock,
      title: '等待回檔買點',
      body: `現價 ${price} 已離月線過遠，等回檔至 ${low} ~ ${high} 再進場${
        downGap ? `（還需 ${downGap}）` : ''
      }`,
      className: 'bg-amber-500/10 border-amber-500/40 text-amber-500',
    },
    wait_breakout: {
      Icon: Clock,
      title: '等待突破買點',
      body: `現價 ${price}，站回 ${low} 之上這份計畫才成立${
        upGap ? `（還需 ${upGap}）` : ''
      }`,
      className: 'bg-amber-500/10 border-amber-500/40 text-amber-500',
    },
    stop_breached: {
      Icon: XCircle,
      title: '已跌破停損，不建議進場',
      body: `現價 ${price} 已低於停損 ${stop}，原計畫的前提不成立`,
      className: 'bg-destructive/10 border-destructive/40 text-destructive',
    },
    insufficient_data: {
      Icon: HelpCircle,
      title: '資料不足，無法給出建議',
      body: '缺少計算交易計畫所需的價格或波動資料',
      className: 'bg-muted border-border text-muted-foreground',
    },
  }[advice.action];

  // 後端之後會新增狀態，而快照是從 localStorage 直接 JSON.parse 回來的，
  // 沒有任何執行期驗證 —— 認不得的狀態就整塊不渲染，
  // 不要讓一個沒見過的字串把整張頁面帶下去。
  if (!view) return null;

  const { Icon, title, body, className } = view;
  const stale = priceStaleness(priceAsOf, now);

  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${className}`}>
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="space-y-1 min-w-0">
        <div className="font-bold">{title}</div>
        <div className="text-sm text-foreground/80 break-words">{body}</div>
        {/* 這行先前是 text-xs 的灰字，而它正上方的現價是 text-xl 粗體 ——
            視覺權重與資訊重要性完全相反。使用者最容易犯的錯就是照著昨天的
            收盤價今天掛單，而台股開盤跳空是常態。過期時給警示底色，
            並把「幾天前」直接算出來：連假後那個差距可能是四天。 */}
        {stale && (
          <div
            className={`text-xs rounded px-2 py-1 mt-1 ${
              stale.stale
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium'
                : 'text-muted-foreground'
            }`}
          >
            {stale.stale
              ? `⚠️ 這是 ${stale.days} 個日曆日前（${priceAsOf}）的收盤價，非盤中即時報價 —— 請勿直接照此價位掛單`
              : `以 ${priceAsOf} 收盤價判斷，非盤中即時報價`}
          </div>
        )}
      </div>
    </div>
  );
}
