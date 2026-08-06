import React from 'react';
import { StockDetailResult, InvestorChips } from '@workspace/api-client-react';
import { formatLots } from '@/lib/format';

type Chips = NonNullable<StockDetailResult['chips']>;
type WindowKey = 'd1' | 'd5' | 'd10' | 'd20';

const WINDOWS: Array<{ key: WindowKey; label: string }> = [
  { key: 'd1', label: '1日' },
  { key: 'd5', label: '5日' },
  { key: 'd10', label: '10日' },
  { key: 'd20', label: '20日' },
];

/**
 * 法人動向的文案。
 *
 * 六種有方向的狀態刻意不合併成「買／賣」兩種 —— 「累積仍是買超但近5日在賣」
 * 與「買超且還在加碼」在累積數字上都是正的，但對進場時機的意義完全相反，
 * 而那正是單一 30 日累積會蓋掉的東西。
 */
const TRENDS: Record<InvestorChips['trend'], { label: string; className: string }> = {
  accumulating: { label: '持續加碼', className: 'text-up' },
  slowing: { label: '買盤退潮', className: 'text-amber-500' },
  reversing_down: { label: '近期轉賣', className: 'text-down' },
  distributing: { label: '持續減碼', className: 'text-down' },
  easing: { label: '賣壓趨緩', className: 'text-amber-500' },
  reversing_up: { label: '近期轉買', className: 'text-up' },
  neutral: { label: '無明顯方向', className: 'text-muted-foreground' },
  insufficient_data: { label: '資料不足', className: 'text-muted-foreground' },
};

const ROWS: Array<{ key: 'foreign' | 'trust' | 'dealer'; label: string }> = [
  { key: 'foreign', label: '外資' },
  { key: 'trust', label: '投信' },
  { key: 'dealer', label: '自營商' },
];

function lotsClass(shares: number | null | undefined): string {
  if (shares == null || !Number.isFinite(shares) || shares === 0) return 'text-muted-foreground';
  return shares > 0 ? 'text-up' : 'text-down';
}

interface ChipsPanelProps {
  chips: Chips;
  chipsAsOf?: string | null;
}

/**
 * 三大法人買賣超，可切換天期。
 *
 * 固定只給 30 日累積的問題在於稀釋：法人前 15 天大買、最近 5 天連續調節，
 * 累積數字仍是漂亮的正值。使用者真正要判斷的是「近期態度」，
 * 而那需要短天期與長天期並陳。
 */
export function ChipsPanel({ chips, chipsAsOf }: ChipsPanelProps) {
  const [active, setActive] = React.useState<WindowKey>('d5');

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">法人買賣超</span>
        <div className="flex rounded-md border border-border overflow-hidden">
          {WINDOWS.map(({ key, label }) => {
            const selected = key === active;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => setActive(key)}
                className={`px-2 py-0.5 text-xs transition-colors ${
                  selected
                    ? 'bg-foreground text-background font-bold'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        {ROWS.map(({ key, label }) => {
          const investor = chips[key];
          const value = investor?.windows?.[active];
          // 後端之後會新增動向狀態，而快照是從 localStorage 直接 JSON.parse 回來的，
          // 沒有任何執行期驗證。整個 app 沒有 ErrorBoundary，認不得的字串
          // 在這裡查表查不到就會把整張頁面帶下去 —— 退回「資料不足」而不是丟例外。
          const trend = TRENDS[investor?.trend as InvestorChips['trend']] ?? TRENDS.insufficient_data;
          return (
            <div key={key} className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground shrink-0">{label}</span>
              <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
              <span className={`font-mono font-medium ${lotsClass(value)}`}>
                {formatLots(value)}
              </span>
              <span
                className={`text-xs shrink-0 w-20 text-right whitespace-nowrap ${trend.className}`}
              >
                {trend.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* 動向那一欄不隨天期切換而變 —— 它固定以近 5 日相對近 20 日的力道判定。
          不寫清楚的話，使用者會以為切到「1日」時動向講的是當天。 */}
      {/* 收合而非刪除：這句話該在的時候要在，但它是方法論說明，
          不是每次看卡片都要重讀的東西 */}
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer select-none">動向怎麼判定的</summary>
        <p className="mt-1 leading-relaxed">
          動向以近 5 日相對近 20 日的力道變化判定，不隨上方天期切換。
          {chips.tradingDays < 20 && `　目前僅取得 ${chips.tradingDays} 個交易日，長天期尚無法計算。`}
          {chipsAsOf && `　資料截至 ${chipsAsOf}`}
        </p>
      </details>
    </div>
  );
}
