import React from 'react';
import { Clock3 } from 'lucide-react';

interface DataFreshnessProps {
  priceAsOf?: string | null;
  chipsAsOf?: string | null;
  revenueAsOf?: string | null;
}

/**
 * 三個資料來源各自的最新日期。
 *
 * 刻意不合成單一「更新時間」：股價、法人與月營收的更新節奏不同
 * （月營收甚至差到一個月），一個數字會讓使用者以為全部都是最新的。
 * 日線本身還延遲一天，所以這裡標的是資料日期，不是查詢時間。
 */
export function DataFreshness({ priceAsOf, chipsAsOf, revenueAsOf }: DataFreshnessProps) {
  const sources = [
    { label: '股價', value: priceAsOf },
    { label: '法人', value: chipsAsOf },
    { label: '營收', value: revenueAsOf },
  ].filter((s) => Boolean(s.value));

  // 一個來源的日期都沒有時整塊不渲染，不顯示空殼
  if (sources.length === 0) return null;

  // 三個日期先前平鋪在標題區佔一整行。收合而非合成單一日期 ——
  // 合成正是這個元件存在的理由要避免的事（見上方註解）。
  // 股價日期本來就印在操作建議橫幅裡（「以 X 收盤價判斷」），
  // 那才是它真正該出現的地方；這裡負責的是另外兩個來源。
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none flex items-center gap-1 w-fit">
        <Clock3 className="w-3 h-3" /> 資料日期
      </summary>
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1">
        {sources.map((s) => (
          <span key={s.label} className="font-mono">
            {s.label} {s.value}
          </span>
        ))}
      </div>
    </details>
  );
}
