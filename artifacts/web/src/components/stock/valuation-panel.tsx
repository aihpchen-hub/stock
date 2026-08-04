import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  StockDetailResult,
  MetricBand,
  getStockFundamentalsQueryOptions,
} from '@workspace/api-client-react';

const num = (v: number | null | undefined, digits = 2, suffix = '') =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${suffix}`;

/**
 * 一條估值帶：目前值、五年區間位置、端點。
 *
 * 只給「目前本益比 26.6」回答不了價值投資人真正要問的事 —— 這個數字在
 * 它自己的歷史裡算高還是低。百分位把它放回區間：第 80 百分位代表過去
 * 五年有八成的時間比現在便宜。
 */
function Band({ label, band, unit }: { label: string; band?: MetricBand; unit: string }) {
  if (!band || band.samples === 0) return null;

  const p = band.percentile;
  // 高百分位對本益比是貴、對殖利率是便宜 —— 因此這裡不上色，只陳述位置。
  // 顏色會把「高」直接翻譯成「好」或「壞」，而那要看是哪個指標。
  const pos = p == null ? null : Math.max(0, Math.min(100, p));

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
        <span className="font-mono font-bold shrink-0">{num(band.current, 2, unit)}</span>
        {p != null && (
          <span className="text-xs text-muted-foreground shrink-0">第 {p.toFixed(0)} 百分位</span>
        )}
      </div>
      {pos != null && (
        <div className="relative h-1.5 bg-muted rounded-full">
          <div
            className="absolute top-1/2 -translate-y-1/2 w-1.5 h-3 bg-foreground rounded-sm"
            style={{ left: `calc(${pos}% - 3px)` }}
          />
        </div>
      )}
      <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
        <span>低 {num(band.low, 1)}</span>
        <span>中位 {num(band.median, 1)}</span>
        <span>高 {num(band.high, 1)}</span>
      </div>
    </div>
  );
}

export function ValuationPanel({ valuation }: { valuation?: StockDetailResult['valuation'] }) {
  // 三個指標全都沒有樣本時整塊不渲染 —— 一個只會說「缺乏資料」的區塊
  // 比沒有這個區塊更傷信任
  const samples = Math.max(
    valuation?.per?.samples ?? 0,
    valuation?.pbr?.samples ?? 0,
    valuation?.dividendYield?.samples ?? 0,
  );
  if (!valuation || samples === 0) return null;

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">估值區間（近五年）</span>
        {valuation.asOf && (
          <span className="text-[11px] text-muted-foreground font-mono">截至 {valuation.asOf}</span>
        )}
      </div>

      <Band label="本益比" band={valuation.per} unit="" />
      <Band label="股價淨值比" band={valuation.pbr} unit="" />
      <Band label="殖利率" band={valuation.dividendYield} unit="%" />

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        百分位為目前值在近五年 {samples.toLocaleString()} 個交易日中的位置。
        本益比高百分位代表相對貴，殖利率高百分位代表相對便宜 —— 方向相反，因此不上色。
        虧損期間沒有本益比，那些日子不計入樣本。
      </p>
    </div>
  );
}

export function DividendPanel({ dividend }: { dividend?: StockDetailResult['dividend'] }) {
  if (!dividend || (dividend.consecutiveYears === 0 && dividend.filledTotal === 0)) return null;

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
      <span className="text-xs text-muted-foreground">股利政策</span>

      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground shrink-0">連續配息</span>
        <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
        <span className="font-mono font-bold shrink-0">{dividend.consecutiveYears} 年</span>
      </div>

      {dividend.latestCash != null && (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">
            最近年度（{dividend.latestYear}）現金股利
          </span>
          <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
          <span className="font-mono shrink-0">{num(dividend.latestCash, 2)} 元</span>
        </div>
      )}

      {dividend.avgCash5y != null && (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">近五個配息年度平均</span>
          <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
          <span className="font-mono shrink-0">{num(dividend.avgCash5y, 2)} 元</span>
        </div>
      )}

      {dividend.filledTotal > 0 && (
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground shrink-0">填息紀錄</span>
          <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
          <span className="font-mono shrink-0">
            {dividend.filled} / {dividend.filledTotal} 次
          </span>
        </div>
      )}

      {/* 資料涵蓋起點必須寫出來：FinMind 的股利資料自 2005 年起，
          寫「連續配息 20 年」會被讀成完整歷史，而那不是我們知道的事。 */}
      {dividend.coverageFrom && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          股利資料自 {dividend.coverageFrom} 年起，連續年數由最近一次往回計算至中斷為止。
          填息以除息後最高價是否回到除息前價位判定。
        </p>
      )}
    </div>
  );
}

/**
 * 財報品質比率 —— 延後載入。
 *
 * 這一塊取代了「護城河敘述」：模型的形容詞不可驗算，毛利率與 ROE 的
 * 多季趨勢可以。而且模型的呼叫發生在抓取個股資料之前，它從未看過
 * 任何數字，要它描述護城河必然是憑印象。
 */
export function FinancialsPanel({ code, enabled }: { code: string; enabled: boolean }) {
  // 用 options getter 再覆寫 enabled／staleTime：產生出來的 hook 把 query 選項
  // 型別成完整的 UseQueryOptions（要求 queryKey），傳部分選項過不了型別檢查。
  // 財報是季頻，半天內不必重抓。
  const { data, isPending, isError } = useQuery({
    ...getStockFundamentalsQueryOptions(code),
    enabled,
    staleTime: 12 * 60 * 60 * 1000,
  });

  if (!enabled) return null;

  if (isPending) {
    return (
      <div className="bg-muted/30 border border-border rounded-lg p-3">
        <div className="h-4 bg-muted rounded w-1/3 animate-pulse" />
      </div>
    );
  }

  // 抓不到或無資料時整塊不渲染，不顯示一個只會說「沒有資料」的區塊
  if (isError || !data || data.quarters.length === 0) return null;

  const quarters = data.quarters.slice(0, 8);

  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">財務品質（近 {quarters.length} 季）</span>
        {data.asOf && (
          <span className="text-[11px] text-muted-foreground font-mono">資料截至 {data.asOf}</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-medium py-1 pr-2">季別</th>
              <th className="text-right font-medium py-1 px-2">毛利率</th>
              <th className="text-right font-medium py-1 px-2">營益率</th>
              <th className="text-right font-medium py-1 px-2">ROE</th>
              <th className="text-right font-medium py-1 px-2">負債比</th>
              <th className="text-right font-medium py-1 pl-2">EPS</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {quarters.map((q) => (
              <tr key={q.date} className="border-t border-border/60">
                <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{q.date}</td>
                <td className="text-right py-1 px-2">{num(q.grossMargin, 1, '%')}</td>
                <td className="text-right py-1 px-2">{num(q.operatingMargin, 1, '%')}</td>
                <td className="text-right py-1 px-2">{num(q.roe, 1, '%')}</td>
                <td className="text-right py-1 px-2">{num(q.debtRatio, 1, '%')}</td>
                <td className="text-right py-1 pl-2">{num(q.eps, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {quarters[0]?.fcf != null && (
        <div className="flex items-baseline justify-between gap-2 text-sm pt-1">
          <span className="text-muted-foreground shrink-0">
            自由現金流（{quarters[0].date} 單季）
          </span>
          <span className="flex-1 border-b border-dotted border-border/60 min-w-2" />
          <span className="font-mono shrink-0">
            {(quarters[0].fcf / 100_000_000).toFixed(1)} 億
          </span>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        ROE 為單季值、非年化。自由現金流＝營運現金流減資本支出；原始財報的現金流量表
        是累計數（第四季為全年），此處已還原成單季，才能與同列的單季毛利率對照。
        財報季頻且發布有延遲，最新一季未必等於最近的實際經營狀況。
      </p>
    </div>
  );
}
