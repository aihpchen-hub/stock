import React, { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQueries } from '@tanstack/react-query';
import { 
  useAnalyzeIndustry, 
  getStockDetailQueryOptions, 
  AnalyzeResult, 
  StockDetailResult,
  AnalyzeRequestPeriod
} from '@workspace/api-client-react';
import { deriveAdvice } from '@workspace/advice';
import { loadSnapshot, save, makeSnapshotId, AnalysisSnapshot } from '@/lib/history';
import { latestFor, loadVerify } from '@/lib/verifyStore';
import { useSettings } from '@/hooks/use-settings';
import { StockCard } from '@/components/stock-card';
import { ArrowLeft, Loader2, Newspaper, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function Analysis() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const keyword = searchParams.get('keyword');
  const period = searchParams.get('period') as AnalyzeRequestPeriod;
  const snapshotId = searchParams.get('snapshotId');

  const { settings, loading: settingsLoading } = useSettings();
  const analyzeMut = useAnalyzeIndustry();

  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [restoredDetails, setRestoredDetails] = useState<Record<string, StockDetailResult>>({});
  const [isRestoring, setIsRestoring] = useState(!!snapshotId);
  const [saved, setSaved] = useState(false);

  // 1. Fetch or Restore
  useEffect(() => {
    if (snapshotId) {
      loadSnapshot(snapshotId).then(snap => {
        if (snap) {
          setAnalysis(snap.analysis);
          setRestoredDetails(snap.stockDetails);
        } else {
          // Fallback if snapshot missing
          setLocation('/');
        }
      });
    } else if (keyword && period) {
      analyzeMut.mutate({ data: { keyword, period } }, {
        onSuccess: (data) => setAnalysis(data),
        onError: () => {
          alert('分析失敗');
          setLocation('/');
        }
      });
    } else {
      setLocation('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotId, keyword, period]);

  // 2. Fetch stock details if new analysis
  const queries = useQueries({
    queries: (analysis && !isRestoring) 
      ? analysis.stocks.map(s => getStockDetailQueryOptions(s.code, { period })) 
      : []
  });

  const derivedStockDetails = useMemo(() => {
    if (isRestoring) return restoredDetails;
    if (!analysis) return {};
    const map: Record<string, StockDetailResult> = {};
    queries.forEach((q, i) => {
      const code = analysis.stocks[i].code;
      if (q.data) map[code] = q.data;
    });
    return map;
  }, [isRestoring, restoredDetails, analysis, queries]);

  // 3. Save snapshot
  useEffect(() => {
    if (!isRestoring && analysis && queries.length > 0 && queries.every(q => !q.isPending) && !saved) {
      const snap: AnalysisSnapshot = {
        id: makeSnapshotId(),
        createdAt: Date.now(),
        keyword: keyword!,
        period: period as AnalyzeRequestPeriod,
        analysis,
        stockDetails: derivedStockDetails,
      };
      save(snap).catch(console.error);
      setSaved(true);
    }
  }, [queries, analysis, isRestoring, saved, derivedStockDetails, keyword, period]);

  // 驗證結果只在掛載時讀一次 —— 它是使用者在首頁跑出來的，本頁不會改變它，
  // 沒有理由每次 render 都重新解析一遍 localStorage。
  const verifySummaries = useMemo(() => loadVerify(), []);

  const sortedStocks = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.stocks].sort((a, b) => {
      const evA = derivedStockDetails[a.code]?.ev ?? -Infinity;
      const evB = derivedStockDetails[b.code]?.ev ?? -Infinity;
      return evB - evA;
    });
  }, [analysis, derivedStockDetails]);

  const isAnalyzing = !snapshotId && (!analysis || queries.some(q => q.isPending));

  if (settingsLoading) return null;

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full p-4 md:p-8 space-y-8 pb-20">
      {/* Top Nav */}
      <button 
        onClick={() => setLocation('/')}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />返回首頁
      </button>

      {/* Loading Overlay */}
      {isAnalyzing && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card border border-border p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm text-center space-y-6">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <div>
              <h2 className="text-xl font-bold mb-2">AI 分析中...</h2>
              <p className="text-sm text-muted-foreground">
                {!analysis 
                  ? `正在搜尋「${keyword}」近期產業新聞與拆解供應鏈...` 
                  : `正在為 ${analysis.stocks.length} 檔標的計算情境期望值與交易計畫...`}
              </p>
            </div>
            {analysis && (
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-primary h-full transition-all duration-300" 
                  style={{ width: `${(queries.filter(q => !q.isPending).length / queries.length) * 100}%` }} 
                />
              </div>
            )}
          </div>
        </div>
      )}

      {analysis && (
        <>
          {/* Header */}
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <h1 className="text-3xl md:text-4xl font-black text-foreground">
                {analysis.keyword}
              </h1>
              <span className="px-3 py-1 bg-muted text-muted-foreground rounded-md font-mono text-sm border border-border">
                {analysis.period}
              </span>
              <SentimentBadge sentiment={analysis.sentiment} />
            </div>
            
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm leading-relaxed text-foreground/90">
              {analysis.summary}
            </div>
          </div>

          {/* Catalysts */}
          {(analysis.catalystDetails || analysis.catalysts)?.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-accent" /> 產業催化劑
              </h2>
              <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
                <ul className="space-y-3">
                  {analysis.catalystDetails ? (
                    analysis.catalystDetails.map((c, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="text-accent mt-0.5">•</span>
                        <span>
                          {c.text}
                          {c.source != null && (
                            <a href={analysis.newsItems?.[c.source - 1]?.url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-accent hover:underline bg-accent/10 px-1.5 py-0.5 rounded">
                              [出處 #{c.source}]
                            </a>
                          )}
                        </span>
                      </li>
                    ))
                  ) : (
                    analysis.catalysts?.map((c, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="text-accent mt-0.5">•</span>
                        <span>{c}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </section>
          )}

          {/* EV Ranking Table */}
          {sortedStocks.length >= 2 && (
            <section className="space-y-4">
              <h2 className="text-xl font-bold">期望值排名</h2>
              <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="px-4 py-3 font-medium">代號</th>
                      <th className="px-4 py-3 font-medium">公司</th>
                      <th className="px-4 py-3 font-medium text-right">現價</th>
                      <th className="px-4 py-3 font-medium text-right">E(V)</th>
                      <th className="px-4 py-3 font-medium text-center">訊號</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedStocks.map(stock => {
                      const d = derivedStockDetails[stock.code];
                      if (!d || d.ev == null) return null;
                      // 與個股卡片用同一套判斷：舊快照沒有 advice 欄位，用存下的價位重算。
                      // 少了這一步，這張表會寫「強烈買進」而下方同一檔的卡片寫
                      // 「已跌破停損，不建議進場」—— 正是本階段要消除的那類矛盾。
                      const advice =
                        d.advice ??
                        deriveAdvice({
                          currentPrice: d.currentPrice ?? null,
                          entryLow: d.entryLow ?? null,
                          entryHigh: d.entryHigh ?? null,
                          stopLoss: d.stopLoss ?? null,
                        });
                      return (
                        <tr key={stock.code} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-muted-foreground">{stock.code}</td>
                          <td className="px-4 py-3 font-bold">{stock.name}</td>
                          <td className="px-4 py-3 text-right font-mono">
                            {d.currentPrice ?? '—'}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono font-medium ${d.ev >= 0 ? 'text-primary' : 'text-destructive'}`}>
                            {d.ev > 0 ? '+' : ''}{d.ev.toFixed(2)}%
                          </td>
                          <td className="px-4 py-3 text-center">
                            {advice.planKind === 'none' ? (
                              <span className="text-xs bg-destructive/10 text-destructive px-2 py-1 rounded border border-destructive/30">
                                不建議進場
                              </span>
                            ) : (
                              d.evSignal && (
                                <span className="text-xs bg-muted px-2 py-1 rounded text-foreground border border-border">
                                  {formatSignalLabel(d.evSignal)}
                                </span>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Stock Cards */}
          <section className="space-y-6">
            <h2 className="text-xl font-bold">供應鏈標的詳情</h2>
            <div className="grid gap-6">
              {sortedStocks.map((stock, i) => {
                const detail = derivedStockDetails[stock.code];
                const isLoading = !isRestoring && (!queries[i] || queries[i].isPending);
                return (
                  <StockCard
                    key={stock.code}
                    stock={stock}
                    detail={detail}
                    loading={isLoading}
                    settings={settings}
                    verified={
                      detail?.ruleVersion != null
                        ? latestFor(verifySummaries, detail.ruleVersion)
                        : null
                    }
                  />
                );
              })}
            </div>
          </section>

          {/* News */}
          {analysis.newsItems?.length > 0 && (
            <section className="space-y-4 pt-8">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-muted-foreground" /> 參考新聞
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {analysis.newsItems.map((news, i) => (
                  <a 
                    key={i} 
                    href={news.url} 
                    target="_blank" 
                    rel="noreferrer"
                    className="bg-card border border-border hover:border-accent p-4 rounded-xl shadow-sm transition-colors group flex items-start gap-4"
                  >
                    <span className="bg-muted text-muted-foreground w-6 h-6 flex items-center justify-center rounded text-xs font-bold shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium group-hover:text-accent transition-colors line-clamp-2">
                      {news.title}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  if (sentiment === 'bullish') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 bg-primary/20 text-primary rounded-md font-bold text-sm border border-primary/30">
        <TrendingUp className="w-4 h-4" /> 看多
      </div>
    );
  }
  if (sentiment === 'bearish') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 bg-destructive/20 text-destructive rounded-md font-bold text-sm border border-destructive/30">
        <TrendingDown className="w-4 h-4" /> 看空
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 bg-muted text-foreground rounded-md font-bold text-sm border border-border">
      <Minus className="w-4 h-4" /> 盤整
    </div>
  );
}

function formatSignalLabel(signal: string) {
  switch (signal) {
    case 'strong_buy': return '強烈買進';
    case 'buy': return '買進';
    case 'watch_positive': return '觀望偏多';
    case 'watch_negative': return '觀望偏空';
    case 'avoid': return '規避';
    default: return signal;
  }
}
