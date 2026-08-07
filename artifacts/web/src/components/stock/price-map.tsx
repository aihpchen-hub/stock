import React from 'react';
import {
  buildPriceMap,
  buildTrend,
  priceMapNote,
  type PriceMapInput,
  type PriceMapKey,
} from '@/lib/priceMap';

/**
 * 價位地圖。
 *
 * 交易計畫給的是一組彼此無關的數字：進場 104~108、停損 100、停利 120、月線 106。
 * 看得懂每一個，卻看不出「進場區其實壓在月線上」或「現價離停損還有 9%」——
 * 那要把它們放到同一根軸上才看得出來。
 *
 * 刻度線畫在真實比例上，標籤在靠得太近時才被推開（見 `lib/priceMap`）。
 * 兩者分開，是為了讓圖本身永遠不說謊。
 */

interface Style {
  /** 刻度線 */
  line: string;
  /** 標籤文字 */
  text: string;
  dashed: boolean;
}

const STYLES: Record<PriceMapKey, Style> = {
  take_profit: { line: 'border-up', text: 'text-up', dashed: false },
  first_target: { line: 'border-up/60', text: 'text-up/80', dashed: true },
  entry_high: { line: 'border-primary/50', text: 'text-foreground/80', dashed: true },
  entry_low: { line: 'border-primary/50', text: 'text-foreground/80', dashed: true },
  current: { line: 'border-foreground', text: 'text-foreground font-bold', dashed: false },
  stop_loss: { line: 'border-down', text: 'text-down', dashed: false },
  trailing_stop: { line: 'border-down/50', text: 'text-down/80', dashed: true },
  ma20: { line: 'border-muted-foreground/40', text: 'text-muted-foreground', dashed: true },
  ma60: { line: 'border-muted-foreground/40', text: 'text-muted-foreground', dashed: true },
  swing_high: { line: 'border-muted-foreground/25', text: 'text-muted-foreground/70', dashed: true },
  swing_low: { line: 'border-muted-foreground/25', text: 'text-muted-foreground/70', dashed: true },
};

/** 均線是算出來的平均值，不會落在合法檔位上，因此小數必須留 */
const price = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));

const gap = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

export function PriceMap(input: PriceMapInput) {
  const levels = buildPriceMap(input);
  if (levels.length === 0) return null;

  // 走勢與刻度共用同一個軸（見 lib/priceMap 的 axisRange），因此線與刻度
  // 必然對得起來。序列不足時為 null，這張圖就退回原本的純刻度版本。
  const trend = buildTrend(input);

  const entryLow = levels.find((l) => l.key === 'entry_low');
  const entryHigh = levels.find((l) => l.key === 'entry_high');
  const note = priceMapNote(input.planKind);
  const pending = input.planKind === 'conditional';

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">價位地圖</span>
        {/* 計畫尚未成立時，這個標記與底下的注記是使用者唯一的提醒 ——
            少了它，一條畫得好好的進場帶看起來就像現在能用 */}
        {pending ? (
          <span className="text-[10px] text-amber-500 font-medium">計畫尚未成立</span>
        ) : (
          <span className="text-[10px] text-muted-foreground/70">
            {/* 沒有 x 軸的線必須說得出自己畫的是多久 */}
            {trend ? `近 ${trend.bars} 個交易日 · 依真實比例` : '依真實比例'}
          </span>
        )}
      </div>

      {/* 外層的上下留白不是裝飾：標籤用 translateY(50%) 對齊刻度，
          貼在軸頂或軸底的那一個會有一半落在繪圖區外，沒有這圈留白就被切掉。
          絕對定位以 padding box 為準，留白必須加在外層才有效。 */}
      <div className="py-3">
        <div className="relative h-[300px]">
          {/* 走勢線畫在最底層，刻度與標籤蓋在它上面。
              preserveAspectRatio="none" 讓 viewBox 直接對應容器；
              non-scaling-stroke 避免線寬被非等比縮放拉扁。
              aria-hidden 是因為所有數值在右側標籤欄都有文字版本。 */}
          {trend && (
            <svg
              className="absolute inset-y-0 left-0 w-[42%]"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                d={trend.areaPath}
                className={
                  trend.direction === 'down'
                    ? 'fill-down/10'
                    : trend.direction === 'up'
                      ? 'fill-up/10'
                      : 'fill-muted-foreground/10'
                }
              />
              <polyline
                points={trend.points}
                fill="none"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                className={
                  trend.direction === 'down'
                    ? 'stroke-down'
                    : trend.direction === 'up'
                      ? 'stroke-up'
                      : 'stroke-muted-foreground'
                }
              />
            </svg>
          )}

          {/* 進場區畫成色帶而非兩條線 —— 它是一段可以進場的範圍，不是兩個價位 */}
          {entryLow && entryHigh && entryHigh.pct > entryLow.pct && (
            <div
              className={`absolute left-0 w-[42%] rounded-sm border-y ${
                pending
                  ? 'bg-amber-500/5 border-dashed border-amber-500/40'
                  : 'bg-primary/10 border-primary/30'
              }`}
              style={{ bottom: `${entryLow.pct}%`, height: `${entryHigh.pct - entryLow.pct}%` }}
            />
          )}

          {levels.map((level) => {
            const style = STYLES[level.key];
            const primary = level.emphasis === 'primary';
            const displaced = Math.abs(level.labelPct - level.pct) > 0.5;
            return (
              <React.Fragment key={level.key}>
                {/* 刻度線：永遠在 pct，也就是真實比例上的位置 */}
                <div
                  className={`absolute left-0 w-[42%] border-t ${style.line} ${
                    style.dashed ? 'border-dashed' : ''
                  }`}
                  style={{ bottom: `${level.pct}%` }}
                />

                {/* 標籤被推開時補一條連接線，否則看不出這個標籤屬於哪一條刻度 */}
                {displaced && (
                  <div
                    className="absolute w-px bg-border left-[44%]"
                    style={{
                      bottom: `${Math.min(level.pct, level.labelPct)}%`,
                      height: `${Math.abs(level.labelPct - level.pct)}%`,
                    }}
                  />
                )}

                {/* 主要價位用 text-sm：這張圖現在是卡片上唯一一份價位陳述，
                    使用者要從這裡抄數字進下單畫面，11px 抄不動。
                    均線與 20 日高低維持小字，它們是判斷用的背景。 */}
                <div
                  className="absolute left-[46%] right-0 flex items-baseline gap-1.5 translate-y-1/2 whitespace-nowrap"
                  style={{ bottom: `${level.labelPct}%` }}
                >
                  <span
                    className={`${primary ? 'text-xs' : 'text-[11px]'} ${style.text}`}
                  >
                    {level.label}
                  </span>
                  <span
                    className={`${
                      primary ? 'text-sm font-medium' : 'text-[11px]'
                    } font-mono ${style.text}`}
                  >
                    {price(level.value)}
                  </span>
                  {level.fromCurrent != null && (
                    <span className="text-[10px] font-mono text-muted-foreground/70">
                      {gap(level.fromCurrent)}
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {note && (
        <p
          className={`text-[10px] leading-relaxed ${
            pending ? 'text-amber-500/90' : 'text-muted-foreground'
          }`}
        >
          {note}
        </p>
      )}
    </div>
  );
}
