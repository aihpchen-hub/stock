import React, { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Search, History, Settings, CheckCircle2, ChevronDown, ChevronRight, X, TrendingUp, AlertTriangle } from 'lucide-react';
import { useSettings } from '@/hooks/use-settings';
import { useHistory } from '@/hooks/use-history';
import { formatHistoryTime, HistoryMeta } from '@/lib/history';
import { AnalyzeRequestPeriod, useVerifyOutcomes } from '@workspace/api-client-react';
import { buildVerifyItems, OUTCOME_LABEL } from '@/lib/verify';

const CHIPS = [
  'AI水冷散熱', '矽光子', 'CoWoS封裝', 'HBM記憶體', '伺服器供應鏈', 'AI PC', '散熱模組', '電源管理IC'
];

const PERIODS: { label: string; value: AnalyzeRequestPeriod }[] = [
  { label: '1個月', value: '1m' },
  { label: '3個月', value: '3m' },
  { label: '6個月', value: '6m' },
];

export default function Home() {
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState('');
  const [period, setPeriod] = useState<AnalyzeRequestPeriod>('3m');
  const { settings, updateSettings, loading: settingsLoading } = useSettings();
  const { history, removeHistory, clearHistory } = useHistory();
  const verifyOutcomes = useVerifyOutcomes();

  const [verifyResult, setVerifyResult] = useState<any>(null);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!keyword.trim()) return;
    setLocation(`/analysis?keyword=${encodeURIComponent(keyword.trim())}&period=${period}`);
  };

  const handleVerify = async () => {
    try {
      const items = await buildVerifyItems(history);
      if (items.length === 0) {
        alert('目前沒有足夠時間（> 5天）的歷史紀錄可供驗證。');
        return;
      }
      verifyOutcomes.mutate(
        { data: { items } },
        {
          onSuccess: (data) => {
            setVerifyResult(data);
          },
          onError: () => {
            alert('驗證失敗，請稍後再試。');
          }
        }
      );
    } catch (err) {
      console.error(err);
    }
  };

  // Group history by keyword
  const groupedHistory = useMemo(() => {
    const map = new Map<string, HistoryMeta[]>();
    history.forEach((item) => {
      const list = map.get(item.keyword) || [];
      list.push(item);
      map.set(item.keyword, list);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const aMax = Math.max(...a[1].map(x => x.createdAt));
      const bMax = Math.max(...b[1].map(x => x.createdAt));
      return bMax - aMax;
    });
  }, [history]);

  return (
    <div className="flex-1 max-w-4xl mx-auto w-full p-4 md:p-8 space-y-12">
      {/* Header */}
      <header className="text-center space-y-4 pt-12 pb-8">
        <h1 className="text-4xl font-bold tracking-tight text-primary">台股產業分析</h1>
        <p className="text-muted-foreground text-lg">AI 自動拆解供應鏈、計算情境期望值與交易計畫</p>
      </header>

      {/* Search Section */}
      <section className="bg-card border border-border rounded-2xl p-6 shadow-xl space-y-6">
        <form onSubmit={handleSearch} className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <input
            type="text"
            className="w-full bg-background border border-input rounded-xl py-4 pl-12 pr-4 text-lg focus:outline-none focus:ring-2 focus:ring-primary transition-all placeholder:text-muted-foreground/50"
            placeholder="輸入產業關鍵字 (例如: AI水冷散熱)..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button
            type="submit"
            className="absolute inset-y-2 right-2 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors"
          >
            分析
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {CHIPS.map(chip => (
            <button
              key={chip}
              onClick={() => setKeyword(chip)}
              className="px-4 py-2 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-sm rounded-full transition-colors border border-border"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="pt-4 border-t border-border">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-muted-foreground">分析週期</span>
            <div className="flex bg-muted p-1 rounded-lg">
              {PERIODS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                    period === p.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-8 items-start">
        {/* Settings Section */}
        <section className="bg-card border border-border rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <Settings className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-bold">部位與資金設定</h2>
          </div>
          
          {!settingsLoading && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground block">可動用資金 (NT$)</label>
                <input
                  type="number"
                  className="w-full bg-background border border-input rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  value={settings.capital}
                  onChange={(e) => updateSettings({ capital: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground block">單筆最大虧損 (NT$)</label>
                <input
                  type="number"
                  className="w-full bg-background border border-input rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  value={settings.riskBudget}
                  onChange={(e) => updateSettings({ riskBudget: Number(e.target.value) })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground block">單檔上限 (%)</label>
                  <input
                    type="number"
                    className="w-full bg-background border border-input rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                    value={settings.maxPositionPct * 100}
                    onChange={(e) => updateSettings({ maxPositionPct: Number(e.target.value) / 100 })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground block">手續費折扣 (折)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full bg-background border border-input rounded-lg px-4 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
                    value={settings.feeDiscount * 10}
                    onChange={(e) => updateSettings({ feeDiscount: Number(e.target.value) / 10 })}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Verification Section */}
        {history.length > 0 && (
          <section className="bg-card border border-border rounded-2xl p-6 space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-5 h-5 text-accent" />
              <h2 className="text-xl font-bold">前瞻驗證</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              根據過去留存的交易計畫，以真實歷史日線回測停損停利觸發狀況，驗證情境機率準確度。
            </p>
            <button
              onClick={handleVerify}
              disabled={verifyOutcomes.isPending}
              className="w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {verifyOutcomes.isPending ? '驗證中...' : '對答案'}
            </button>

            {verifyResult && (
              <div className="mt-6 space-y-4 p-4 bg-background rounded-xl border border-border">
                <div className="flex justify-between items-center pb-2 border-b border-border">
                  <span className="text-muted-foreground">達標率</span>
                  <span className="text-2xl font-bold text-primary">
                    {verifyResult.tally.targetRate != null ? `${(verifyResult.tally.targetRate * 100).toFixed(1)}%` : 'N/A'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="bg-muted rounded p-2">
                    <div className="text-primary font-bold">{verifyResult.tally.target}</div>
                    <div className="text-muted-foreground text-xs mt-1">達標</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-destructive font-bold">{verifyResult.tally.stop}</div>
                    <div className="text-muted-foreground text-xs mt-1">停損</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-foreground font-bold">{verifyResult.tally.open}</div>
                    <div className="text-muted-foreground text-xs mt-1">仍持有</div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {/* History Section */}
      {groupedHistory.length > 0 && (
        <section className="space-y-6 pb-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              <h2 className="text-2xl font-bold">查詢紀錄</h2>
            </div>
            <button
              onClick={clearHistory}
              className="text-sm text-destructive hover:underline"
            >
              清除全部
            </button>
          </div>

          <div className="space-y-4">
            {groupedHistory.map(([kw, items]) => (
              <HistoryGroup key={kw} keyword={kw} items={items} onRemove={removeHistory} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function HistoryGroup({ keyword, items, onRemove }: { keyword: string, items: HistoryMeta[], onRemove: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
          <span className="text-lg font-bold">{keyword}</span>
          <span className="text-sm bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{items.length} 筆紀錄</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {items.map(item => (
            <div key={item.id} className="p-4 flex items-center justify-between hover:bg-muted/10 group">
              <div
                className="flex-1 cursor-pointer"
                onClick={() => setLocation(`/analysis?snapshotId=${item.id}`)}
              >
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm text-muted-foreground">{formatHistoryTime(item.createdAt)}</span>
                  <span className="text-xs border border-border rounded px-1.5 py-0.5 bg-background text-muted-foreground uppercase">{item.period}</span>
                  {item.sentiment === 'bullish' && <span className="text-primary text-xs font-medium">● 看多</span>}
                  {item.sentiment === 'bearish' && <span className="text-destructive text-xs font-medium">● 看空</span>}
                  {item.sentiment === 'neutral' && <span className="text-foreground text-xs font-medium">● 盤整</span>}
                </div>
                {item.topCode && (
                  <div className="text-sm flex items-center gap-2">
                    <span className="text-muted-foreground">領先標的:</span>
                    <span className="font-bold text-accent">{item.topName} ({item.topCode})</span>
                    {item.topEv != null && (
                      <span className={`font-mono font-medium ${item.topEv >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        E(V) {item.topEv > 0 ? '+' : ''}{(item.topEv).toFixed(2)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.id);
                }}
                className="p-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
