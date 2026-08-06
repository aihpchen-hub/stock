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
import { rankByStrength } from '@/lib/groupStrength';
import { queriedCode, queriedIdentity } from '@/lib/queriedStock';
import { newsAge } from '@/lib/newsAge';
import { ProfileSwitcher } from '@/components/profile-switcher';
import { DEFAULT_PROFILE, VIEW_CONFIG, type ViewProfile } from '@workspace/view-profile';

const PROFILE_KEY = 'view_profile_v1';

/** 記住上次選的受眾。認不得的值退回預設，不讓一個舊字串把畫面弄壞 */
function loadProfile(): ViewProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw && raw in VIEW_CONFIG ? (raw as ViewProfile) : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}
import { useSettings } from '@/hooks/use-settings';
import { StockCard } from '@/components/stock-card';
import { toast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/apiError';
import { ArrowLeft, Loader2, Newspaper, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

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
  /** 使用者按了「先看已完成的部分」。遮罩是唯一的出口，必須有一個不依賴請求狀態的開關 */
  const [cancelled, setCancelled] = useState(false);

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
        // 不再彈原生 alert 也不再踢回首頁。這次分析花了 16~20 秒，
        // 把使用者連同他輸入的關鍵字一起丟掉，等於要他從頭再來一次；
        // 而後端其實說得出失敗的原因（配額用盡／金鑰無效／模型不可用）。
        onError: (err) => {
          toast({
            variant: 'destructive',
            title: '分析失敗',
            description: apiErrorMessage(err),
          });
        },
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

  /**
   * 還在等的個股明細。
   *
   * 不能只看 isPending：TanStack Query v5 對**停用中**的 query 恆為
   * status 'pending'。模型回一筆 code 為 null 的標的時 enabled 就是 false，
   * 於是這個值永遠是 true —— 全螢幕遮罩永遠不消失、進度條卡在 4/5，
   * 而頁面自己的「返回首頁」在一般流內、被 z-50 的遮罩蓋住點不到；
   * 下面那個存快照的條件也永遠不成立，連查詢紀錄都不會留下。
   * 加看 fetchStatus 之後，停用中的 query（fetchStatus 'idle'）不再算進去。
   *
   * 後端的 sanitizeStocks 已經從源頭擋掉那種輸入，這裡是第二道。
   */
  const stillLoading = queries.some((q) => q.isPending && q.fetchStatus !== 'idle');

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

  /** 這幾檔的明細抓不到。卡片要說出來，排名表的分母也要標明 */
  const failedCodes = useMemo(() => {
    if (isRestoring || !analysis) return new Set<string>();
    const set = new Set<string>();
    queries.forEach((q, i) => {
      const code = analysis.stocks[i]?.code;
      if (code && q.isError) set.add(code);
    });
    return set;
  }, [isRestoring, analysis, queries]);

  // 3. Save snapshot
  useEffect(() => {
    if (!isRestoring && analysis && queries.length > 0 && !stillLoading && !saved) {
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
  }, [queries, stillLoading, analysis, isRestoring, saved, derivedStockDetails, keyword, period]);

  // 驗證結果只在掛載時讀一次 —— 它是使用者在首頁跑出來的，本頁不會改變它，
  // 沒有理由每次 render 都重新解析一遍 localStorage。
  const verifySummaries = useMemo(() => loadVerify(), []);

  // 受眾切換完全在前端 —— 不重新請求、不重算任何數字，只換呈現方式
  const [profile, setProfile] = useState<ViewProfile>(loadProfile);
  const changeProfile = (next: ViewProfile) => {
    setProfile(next);
    try {
      localStorage.setItem(PROFILE_KEY, next);
    } catch {
      // 隱私模式存不下就算了，這一輪的切換仍然有效
    }
  };

  // 族群排名用同一批已載入的明細算，不發任何請求
  const groupRanks = useMemo(
    () =>
      rankByStrength(
        Object.entries(derivedStockDetails).map(([code, d]) => ({
          code,
          return20d: d.returns?.d20 ?? null,
        })),
      ),
    [derivedStockDetails],
  );

  const sortedStocks = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.stocks].sort((a, b) => {
      const evA = derivedStockDetails[a.code]?.ev ?? -Infinity;
      const evB = derivedStockDetails[b.code]?.ev ?? -Infinity;
      return evB - evA;
    });
  }, [analysis, derivedStockDetails]);

  // 使用者查的是哪一檔。查產業關鍵字時為 null —— 那種查詢不指向特定標的
  const queried = useMemo(
    () => (analysis ? queriedCode(analysis.keyword, analysis.stocks) : null),
    [analysis],
  );

  // 標題要印的完整身分。明細還在載入時退回模型給的名稱，標題不會空一塊
  const identity = useMemo(
    () =>
      analysis ? queriedIdentity(analysis.keyword, analysis.stocks, derivedStockDetails) : null,
    [analysis, derivedStockDetails],
  );

  // 卡片順序：查的那檔排第一，其餘維持期望值由高到低。
  // 後端的 prompt 早就要求模型把查詢標的放在第一筆，是上面那次重排把它沖走的 ——
  // 查 5439 卻要滑到第四張卡片才找得到自己查的股票。
  const cardStocks = useMemo(() => {
    if (!queried) return sortedStocks;
    const target = sortedStocks.find((s) => s.code === queried);
    if (!target) return sortedStocks;
    return [target, ...sortedStocks.filter((s) => s.code !== queried)];
  }, [sortedStocks, queried]);

  // 卡片順序與 queries 的順序不同 —— queries 是照 analysis.stocks 建的。
  // 先前用卡片迴圈的 index 去讀 queries，每張卡片拿到的是別檔的載入狀態。
  const queryIndexOf = useMemo(() => {
    const map = new Map<string, number>();
    analysis?.stocks.forEach((s, i) => map.set(s.code, i));
    return map;
  }, [analysis]);

  // 排名表印得出來的列。ev 為 null 的列本來就不渲染，名次的分母必須是這個長度，
  // 否則會出現「第 3/5」而畫面上只有三列。
  const rankedRows = useMemo(
    () =>
      sortedStocks
        .map((stock) => ({ stock, detail: derivedStockDetails[stock.code] }))
        .filter((row) => row.detail?.ev != null),
    [sortedStocks, derivedStockDetails],
  );

  // analyzeMut 失敗時遮罩必須讓開，否則它會蓋住底下那塊錯誤與重試面板
  const isAnalyzing =
    !snapshotId && !cancelled && !analyzeMut.isError && (!analysis || stillLoading);

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
            {analysis && queries.length > 0 && (
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300"
                  style={{ width: `${(queries.filter(q => !q.isPending).length / queries.length) * 100}%` }}
                />
              </div>
            )}
            {/* 遮罩是 fixed inset-0 z-50，會蓋住頁面自己的「返回首頁」。
                不論請求卡在什麼狀態，畫面上都必須有一個出得去的按鈕。 */}
            <div className="flex gap-3 w-full">
              {analysis && (
                <button
                  type="button"
                  onClick={() => setCancelled(true)}
                  className="flex-1 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  先看已完成的部分
                </button>
              )}
              <button
                type="button"
                onClick={() => setLocation('/')}
                className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                取消，返回首頁
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分析失敗時留在原頁。使用者輸入的關鍵字還在網址上，重試不必重打；
          先前是彈一個沒有原因的 alert 然後把人踢回首頁。 */}
      {!analysis && analyzeMut.isError && (
        <div className="bg-card border border-destructive/30 rounded-2xl p-8 max-w-md mx-auto space-y-4 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">分析「{keyword}」沒有成功</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {apiErrorMessage(analyzeMut.error)}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() =>
                analyzeMut.mutate(
                  { data: { keyword: keyword!, period } },
                  {
                    onSuccess: (data) => setAnalysis(data),
                    onError: (err) =>
                      toast({
                        variant: 'destructive',
                        title: '分析失敗',
                        description: apiErrorMessage(err),
                      }),
                  },
                )
              }
              disabled={analyzeMut.isPending}
              className="flex-1 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {analyzeMut.isPending ? '重試中…' : '重試'}
            </button>
            <button
              type="button"
              onClick={() => setLocation('/')}
              className="flex-1 py-2.5 border border-border rounded-lg hover:bg-muted transition-colors"
            >
              返回首頁
            </button>
          </div>
        </div>
      )}

      {analysis && (
        <>
          {/* Header */}
          <div className="space-y-4">
            {/* 查個股時標題先前只印使用者輸入的字串 —— 整頁最大的字就是「5439」，
                哪家公司、什麼產業、甚至這是不是個股查詢，一個字都沒有。
                官方簡稱與官方產業別在明細裡本來就有，只是從未用過。 */}
            {/* 第一行只放身分，第二行放屬性。先前五個元素（公司名、代號、產業、
                週期、情緒）並排，手機上會斷成三行 chips —— 那是把標題變成標籤牆。 */}
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl md:text-4xl font-black text-foreground">
                {identity?.name ?? analysis.keyword}
              </h1>
              {identity && (
                <span className="px-2 py-1 bg-background text-muted-foreground rounded-md font-mono text-base border border-border">
                  {identity.code}
                </span>
              )}
              {/* 產業情緒徽章不放在這裡 —— 見下方總結區。
                  它講的是整個產業的題材，貼在公司名旁邊會被讀成「這支股票看多」，
                  而同一頁的卡片上還有一個由純計算得出的個股訊號可能寫著「觀望偏空」。
                  兩個判斷各自成立，但擺在一起而不說明它們的對象不同，就是矛盾。 */}
            </div>
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-sm text-muted-foreground">
              {identity?.industry && <span>{identity.industry}</span>}
              {identity?.industry && <span className="text-border">·</span>}
              <span className="font-mono">{analysis.period}</span>
              {/* 查個股時下方的名單是「這一檔加上同族群競爭者」，不是純產業掃描。
                  不寫出來的話，使用者看到另外三檔會以為系統搞錯了對象。 */}
              {identity && (
                <>
                  <span className="text-border">·</span>
                  <span>以「{analysis.keyword}」查詢，下方含同族群競爭者</span>
                </>
              )}
            </div>
            
            {/* 產業情緒歸在產業總結這一塊，並明講它的對象是產業題材。
                個股自己的訊號（強烈買進／觀望偏空…）在下方卡片上，那是純計算的
                結果，與這裡的判斷來自不同的層 —— 兩者不一致是常態，不是錯誤。 */}
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-sm font-bold text-muted-foreground">
                  產業題材{identity ? `（${identity.industry ?? '同族群'}）` : ''}
                </h2>
                <SentimentBadge sentiment={analysis.sentiment} />
              </div>
              <p className="leading-relaxed text-foreground/90">{analysis.summary}</p>
              {identity && (
                <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-3">
                  這是對整個產業題材的看法，不是對 {identity.name} 這一檔的買賣建議。
                  個股自己的訊號請看下方卡片 —— 那是由營收、均線與法人籌碼算出來的，
                  與這裡的判斷不一定同方向。
                </p>
              )}
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
          {/* 手機端不顯示。這張表的五個欄位（代號、公司、現價、E(V)、訊號）
              在下方每張卡片上都會再出現一次，而它唯一的附加價值是「橫向比較」——
              窄螢幕一次只看得到一列，那個價值不成立，剩下的就只是重複一次。 */}
          {sortedStocks.length >= 2 && (
            <section className="space-y-4 hidden md:block">
              <h2 className="text-xl font-bold">期望值排名</h2>
              {/* 排名表只列得出有明細的那幾檔。少了這一行，5 檔裡有 2 檔抓失敗時
                  畫面會寫「期望值第 1/3」而使用者手上明明有 5 檔 —— 差額沒有一個字
                  解釋，而真正 E(V) 最高的那檔可能正是沒抓到的其中之一。 */}
              {rankedRows.length < sortedStocks.length && (
                <p className="text-xs text-muted-foreground">
                  {sortedStocks.length - rankedRows.length} 檔因資料未取得或無法計算期望值，
                  未列入本表比較。
                </p>
              )}
              <div className="bg-card border border-border rounded-xl overflow-x-auto shadow-sm">
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
                    {rankedRows.map(({ stock, detail: d }, i) => {
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
                      // 這張表就是排名，把查詢標的拉到第一列會讓「第一列」不再代表
                      // 期望值最高。改成原地標記，並直接寫出它排第幾。
                      const isQueried = stock.code === queried;
                      return (
                        <tr
                          key={stock.code}
                          className={`hover:bg-muted/30 transition-colors ${
                            isQueried ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                          }`}
                        >
                          <td className="px-4 py-3 font-mono text-muted-foreground">{stock.code}</td>
                          <td className="px-4 py-3 font-bold">
                            <span className="flex items-center gap-2 flex-wrap">
                              {stock.name}
                              {isQueried && (
                                <span className="text-[11px] font-medium bg-primary/15 text-primary px-1.5 py-0.5 rounded border border-primary/30">
                                  你查的
                                  {rankedRows.length >= 2 &&
                                    ` · 期望值第 ${i + 1}/${rankedRows.length}`}
                                </span>
                              )}
                            </span>
                          </td>
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
            <div className="space-y-3">
              <h2 className="text-xl font-bold">供應鏈標的詳情</h2>
              <ProfileSwitcher profile={profile} onChange={changeProfile} />
            </div>
            <div className="grid gap-6">
              {cardStocks.map((stock) => {
                const detail = derivedStockDetails[stock.code];
                const query = queries[queryIndexOf.get(stock.code) ?? -1];
                // 失敗與載入中必須分得開，否則失敗的卡片會永遠停在骨架動畫上
                const isLoading =
                  !isRestoring && (!query || (query.isPending && query.fetchStatus !== 'idle'));
                return (
                  <StockCard
                    key={stock.code}
                    stock={stock}
                    detail={detail}
                    loading={isLoading}
                    failed={failedCodes.has(stock.code)}
                    onRetry={query ? () => void query.refetch() : undefined}
                    settings={settings}
                    verified={
                      detail?.ruleVersion != null
                        ? latestFor(verifySummaries, detail.ruleVersion)
                        : null
                    }
                    groupRank={groupRanks[stock.code] ?? null}
                    profile={profile}
                    isQueried={stock.code === queried}
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
                {analysis.newsItems.map((news, i) => {
                  // 一則標題無法自證新舊。實測搜尋結果混進過 2023 年的報導，
                  // 與當月新聞並排而畫面沒有一個字說明 —— 而分析就建立在它上面。
                  const age = newsAge(news.publishedAt);
                  return (
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
                      <span className="min-w-0 space-y-1.5">
                        <span className="block text-sm font-medium group-hover:text-accent transition-colors line-clamp-2">
                          {news.title}
                        </span>
                        <span className="flex items-center gap-2 flex-wrap text-xs">
                          {news.source && (
                            <span className="text-muted-foreground">{news.source}</span>
                          )}
                          {news.source && age && <span className="text-border">·</span>}
                          {/* 抓不到日期時整個不顯示，不以查詢時間充數 */}
                          {age && (
                            <span
                              className={
                                age.stale
                                  ? 'text-amber-500 font-medium'
                                  : 'text-muted-foreground'
                              }
                              title={news.publishedAt ?? undefined}
                            >
                              {age.text}
                              {age.stale && ' ⚠'}
                            </span>
                          )}
                        </span>
                      </span>
                    </a>
                  );
                })}
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
