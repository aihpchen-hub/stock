import React from 'react';
import { StockInfo, StockDetailResult } from '@workspace/api-client-react';
import { RiskSettings, planPosition } from '@/lib/settings';
import { lotEconomics, roundTripCostPct } from '@/lib/fees';
import { TrendingUp, AlertTriangle, Info, Target, ShieldAlert, ArrowRight, ShieldCheck, ExternalLink } from 'lucide-react';

interface StockCardProps {
  stock: StockInfo;
  detail?: StockDetailResult;
  loading: boolean;
  settings: RiskSettings;
}

export function StockCard({ stock, detail, loading, settings }: StockCardProps) {
  if (loading || !detail) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm animate-pulse space-y-4">
        <div className="h-6 bg-muted rounded w-1/3"></div>
        <div className="h-20 bg-muted/50 rounded w-full"></div>
        <div className="h-4 bg-muted rounded w-1/2"></div>
      </div>
    );
  }

  const {
    code,
    ev,
    evSignal,
    pBull,
    pBase,
    pBear,
    rBull,
    rBase,
    rBear,
    entryLow,
    entryHigh,
    stopLoss,
    takeProfit,
    firstTarget,
    riskRewardRatio,
    riskPerLot,
    rewardPerLot,
    trailingStop,
    maSignal,
    revenueYoY,
    foreignNet30d,
    trustNet30d,
  } = detail;

  // Plan position
  const position = planPosition({
    riskBudget: settings.riskBudget,
    capital: settings.capital,
    riskPerLot,
    entryPrice: entryHigh, // conservative estimation using upper entry bound
    maxPositionPct: settings.maxPositionPct,
  });

  // Calculate economics
  const economics = entryHigh && stopLoss && takeProfit ? lotEconomics({
    entry: entryHigh,
    stop: stopLoss,
    target: takeProfit,
    firstTarget: firstTarget,
    discount: settings.feeDiscount,
  }) : null;

  const signalColors = {
    strong_buy: 'bg-primary/20 text-primary border-primary/50',
    buy: 'bg-primary/10 text-primary border-primary/30',
    watch_positive: 'bg-foreground/10 text-foreground border-foreground/20',
    watch_negative: 'bg-foreground/10 text-foreground border-foreground/20',
    avoid: 'bg-destructive/20 text-destructive border-destructive/50',
  };

  const signalLabels = {
    strong_buy: '強烈買進',
    buy: '買進',
    watch_positive: '觀望偏多',
    watch_negative: '觀望偏空',
    avoid: '規避',
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col">
      {/* Header */}
      <div className="p-5 border-b border-border bg-muted/20">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-xl font-bold text-foreground">{stock.name}</h3>
              <span className="text-lg text-muted-foreground font-mono">{stock.code}</span>
              <span className="px-2 py-0.5 bg-accent/20 text-accent text-xs font-medium rounded border border-accent/20">
                {stock.sector}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{stock.reason}</p>
            {stock.reasonSource != null && (
              <span className="inline-flex items-center gap-1 text-xs text-accent mt-2 bg-accent/10 px-2 py-0.5 rounded">
                <ExternalLink className="w-3 h-3" />
                新聞出處 #{stock.reasonSource}
              </span>
            )}
          </div>
          {evSignal && (
            <div className={`px-3 py-1 rounded-full text-sm font-bold border ${signalColors[evSignal]}`}>
              {signalLabels[evSignal]}
            </div>
          )}
        </div>
      </div>

      {/* EV and Scenarios */}
      <div className="p-5 grid md:grid-cols-2 gap-6 border-b border-border">
        {/* EV Result */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-medium">加權期望值 E(V)</span>
            {ev != null && (
              <span className={`text-3xl font-black font-mono ${ev >= 0 ? 'text-primary' : 'text-destructive'}`}>
                {ev > 0 ? '+' : ''}{ev.toFixed(2)}%
              </span>
            )}
          </div>
          
          <div className="space-y-2">
            <ScenarioBar label="多頭" p={pBull} r={rBull} color="bg-primary" />
            <ScenarioBar label="基準" p={pBase} r={rBase} color="bg-muted-foreground" />
            <ScenarioBar label="空頭" p={pBear} r={rBear} color="bg-destructive" />
          </div>
        </div>

        {/* Financial Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="MA 位置" value={formatMaSignal(maSignal)} />
          <MetricCard 
            label="月營收 YoY" 
            value={revenueYoY != null ? `${revenueYoY > 0 ? '+' : ''}${revenueYoY.toFixed(1)}%` : '-'} 
            isPositive={revenueYoY ? revenueYoY > 0 : undefined}
          />
          <MetricCard label="外資30日" value={formatInstitutional(foreignNet30d)} />
          <MetricCard label="投信30日" value={formatInstitutional(trustNet30d)} />
        </div>
      </div>

      {/* Trading Plan */}
      <div className="p-5 bg-background/50 flex-1">
        <h4 className="text-sm font-bold text-muted-foreground mb-4 flex items-center gap-2">
          <Target className="w-4 h-4" /> 交易計畫
        </h4>
        
        {entryLow && entryHigh && stopLoss && takeProfit ? (
          <div className="space-y-5">
            {/* Price Levels */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">進場區間</div>
                <div className="font-mono font-medium text-foreground">{entryLow} - {entryHigh}</div>
              </div>
              <div>
                <div className="text-xs text-destructive mb-1 flex items-center gap-1"><ShieldAlert className="w-3 h-3"/> 停損</div>
                <div className="font-mono font-medium text-destructive">{stopLoss}</div>
              </div>
              <div>
                <div className="text-xs text-primary mb-1 flex items-center gap-1"><Target className="w-3 h-3"/> 停利</div>
                <div className="font-mono font-medium text-primary">{takeProfit}</div>
              </div>
            </div>

            {/* Position Sizing */}
            {position && economics && (
              <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center border-b border-border pb-3">
                  <div>
                    <div className="text-xs text-muted-foreground">建議張數</div>
                    <div className="text-2xl font-bold">{position.lots} <span className="text-sm font-normal">張</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">投入金額</div>
                    <div className="font-mono font-medium">NT$ {position.cost.toLocaleString()}</div>
                  </div>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    風報比: <strong className="text-foreground">{riskRewardRatio?.toFixed(2)}</strong>
                  </span>
                  <span className="text-muted-foreground flex items-center gap-1">
                    單張最大虧損: <strong className="text-destructive font-mono">NT$ {economics.netRiskPerLot.toLocaleString(undefined, {maximumFractionDigits:0})}</strong>
                  </span>
                </div>
                {position.lots > 0 && position.limitedBy === 'risk' && (
                  <div className="text-xs text-amber-500/80 bg-amber-500/10 p-2 rounded">
                    ⚠️ 已達單筆風險上限 ({settings.riskBudget.toLocaleString()})，限制投入張數
                  </div>
                )}
                {position.lots > 0 && position.limitedBy === 'capital' && (
                  <div className="text-xs text-amber-500/80 bg-amber-500/10 p-2 rounded">
                    ⚠️ 已達資金上限比例，限制投入張數
                  </div>
                )}
              </div>
            )}

            {/* Extra notes */}
            <div className="flex flex-wrap gap-2 text-xs">
              {firstTarget && (
                <div className="bg-muted px-2 py-1 rounded text-muted-foreground">
                  第一目標 (1R): <strong className="font-mono text-foreground">{firstTarget}</strong>
                </div>
              )}
              {trailingStop && (
                <div className="bg-muted px-2 py-1 rounded text-muted-foreground">
                  移動停損起始: <strong className="font-mono text-foreground">{trailingStop}</strong>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            無足夠數據生成完整交易計畫
          </div>
        )}
      </div>
    </div>
  );
}

function ScenarioBar({ label, p, r, color }: { label: string, p?: number, r?: number, color: string }) {
  if (p == null || r == null) return null;
  const width = Math.max(4, p * 100);
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-10 text-muted-foreground">{label}</div>
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden flex">
        <div className={`h-full ${color}`} style={{ width: `${width}%` }} />
      </div>
      <div className="w-12 text-right font-mono text-xs">{Math.round(p * 100)}%</div>
      <div className={`w-16 text-right font-mono font-medium ${r >= 0 ? 'text-primary' : 'text-destructive'}`}>
        {r > 0 ? '+' : ''}{r.toFixed(1)}%
      </div>
    </div>
  );
}

function MetricCard({ label, value, isPositive }: { label: string, value: string, isPositive?: boolean }) {
  let colorClass = 'text-foreground';
  if (isPositive === true) colorClass = 'text-primary';
  if (isPositive === false) colorClass = 'text-destructive';

  return (
    <div className="bg-muted/30 border border-border p-3 rounded-lg flex flex-col justify-center">
      <span className="text-xs text-muted-foreground mb-1">{label}</span>
      <span className={`font-mono font-medium ${colorClass}`}>{value}</span>
    </div>
  );
}

function formatMaSignal(signal?: string) {
  switch (signal) {
    case 'above_both': return '站上雙均線';
    case 'above_ma20': return '僅站上月線';
    case 'below_both': return '跌破雙均線';
    default: return '資料不足';
  }
}

function formatInstitutional(qty?: number) {
  if (!qty) return '-';
  const lots = Math.round(qty / 1000);
  return `${lots > 0 ? '+' : ''}${lots}張`;
}
