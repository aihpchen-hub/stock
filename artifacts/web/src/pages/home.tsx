import React, { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Search, History, Settings, CheckCircle2, ChevronDown, ChevronRight, X, TrendingUp, AlertTriangle } from 'lucide-react';
import { useSettings } from '@/hooks/use-settings';
import { useHistory } from '@/hooks/use-history';
import { formatHistoryTime, HistoryMeta } from '@/lib/history';
import { AnalyzeRequestPeriod, useVerifyOutcomes } from '@workspace/api-client-react';
import { buildVerifyGroups, isRipe, OUTCOME_LABEL } from '@/lib/verify';
import { clearVerify, loadVerify, saveVerify, type StoredVerify } from '@/lib/verifyStore';
import { NumberField } from '@/components/number-field';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { apiErrorMessage } from '@/lib/apiError';
import { MIN_DECIDED, isConclusive, mergeTallies, wilson95 } from '@/lib/verifyStats';
import {
  MAX_ALLOWED_POSITION_PCT,
  MAX_FEE_DISCOUNT,
  MIN_FEE_DISCOUNT,
  MIN_POSITION_PCT,
} from '@/lib/settings';

/** 後端 outcome.ts 的 MAX_ITEMS。超過就分批，不讓它靜默截斷 */
const VERIFY_BATCH = 40;

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

  // 初始值直接從 localStorage 讀 —— 先前存在 useState 裡，離開頁面就消失，
  // 使用者每次回到首頁都要重按一次「對答案」，而這個功能的價值來自累積。
  const [verifyResults, setVerifyResults] = useState<StoredVerify[] | null>(() => {
    const stored = loadVerify();
    return stored.length > 0 ? stored : null;
  });

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!keyword.trim()) return;
    setLocation(`/analysis?keyword=${encodeURIComponent(keyword.trim())}&period=${period}`);
  };

  const handleVerify = async () => {
    try {
      const groups = await buildVerifyGroups(history);
      if (groups.length === 0) {
        // 門檻隨週期而異（1m 七日、3m 十四日、6m 廿一日），因此不寫死一個天數
        toast({
          title: '還沒有可以對答案的紀錄',
          description: '計畫要走過一段時間才對得出結論，再過幾天回來看看。',
        });
        return;
      }
      // 逐版本各打一次 —— 不同規則算出來的計畫合併統計會得到一個
      // 量不到任何東西的達標率。
      //
      // 每個版本再依 40 筆分批：後端的 MAX_ITEMS 是 40，超過的部分先前被
      // 靜默截斷，而且截掉的是**最舊**（最可能已結案）的那些。累積三個月
      // 的使用者有 200 筆計畫，畫面上五格加總卻永遠是 40，且 open 與
      // noEntry 被系統性放大 —— 用得越久，decided 反而不會增加。
      const summaries: StoredVerify[] = await Promise.all(
        groups.map(async (g) => {
          const batches: (typeof g.items)[] = [];
          for (let i = 0; i < g.items.length; i += VERIFY_BATCH) {
            batches.push(g.items.slice(i, i + VERIFY_BATCH));
          }
          const parts = await Promise.all(
            batches.map((items) => verifyOutcomes.mutateAsync({ data: { items } })),
          );
          return {
            ruleVersion: g.ruleVersion,
            // 比率由合併後的分子分母重算，不是把各批的百分比平均
            tally: mergeTallies(parts.map((p) => p.tally)),
            verifiedAt: Date.now(),
          };
        }),
      );
      saveVerify(summaries);
      setVerifyResults(summaries);
    } catch (err) {
      console.error(err);
      // 這個函式也會被 useEffect 自動觸發 —— 用原生 alert 的話，
      // 使用者每次回到首頁都會被同一個對話框擋一次。
      toast({
        variant: 'destructive',
        title: '對答案失敗',
        description: apiErrorMessage(err),
      });
    }
  };

  /**
   * 有沒有「夠舊到值得驗證」的紀錄。
   *
   * 前瞻驗證只看得懂夠舊的計畫（門檻隨週期而異）—— 更新的紀錄還沒走完足夠的交易日，
   * 幾乎必然是「仍持有」，對不出任何結論。先前這個區塊只要有任何紀錄就顯示，
   * 於是剛開始用的人只會看到一個按下去回「沒有足夠時間的歷史紀錄」的按鈕。
   * 改成沒有可驗證的紀錄時整塊不渲染，紀錄養夠了它才會帶著真實數據出現。
   */
  const hasRipeHistory = useMemo(
    () => history.some((entry) => isRipe(entry.createdAt, entry.period)),
    [history],
  );

  /**
   * 有可驗證的紀錄而且還沒有任何結果時，自動跑一次。
   *
   * 這個功能的價值來自累積 —— 靠使用者記得手動點擊等於沒有。
   * 只在「完全沒有存下來的結果」時觸發，不做定時重跑：後端一次最多收 40 筆，
   * 而重跑的邊際價值遠低於它消耗的請求。想要更新的人按「重新對答案」即可。
   */
  useEffect(() => {
    if (!hasRipeHistory) return;
    if (verifyResults !== null) return;
    if (verifyOutcomes.isPending) return;
    void handleVerify();
    // handleVerify 每次 render 都是新的參考，列進相依會造成無限迴圈；
    // 這裡要的就是「條件成立時跑一次」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRipeHistory, verifyResults]);

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
            placeholder="產業關鍵字或股票代號 (例如: AI水冷散熱、2330)..."
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

        {/* 個股查詢的整套後端邏輯（代號解析、專屬 prompt、同族群比較）早就存在，
            但畫面上沒有一個字提過 —— 使用者只會照 placeholder 輸入產業關鍵字，
            永遠不會發現這條路。 */}
        <p className="text-sm text-muted-foreground">
          輸入四到六位數的股票代號，會直接分析該檔並找出同族群競爭者一起比較。
        </p>

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
              {/* 四個欄位都改成離開時才提交。先前是每按一次鍵就寫進
                  localStorage 再讀回來，而儲存函式對非正數靜默拒絕 ——
                  退格到剩一位數時舊值立刻被寫回，最後一位刪不掉。 */}
              <NumberField
                label="可動用資金 (NT$)"
                description="帳戶裡現在能拿來買股票的現金，不是總資產"
                value={settings.capital}
                onCommit={(capital) => updateSettings({ capital })}
                min={1}
                integer
              />
              <NumberField
                label="單筆最大虧損 (NT$)"
                description="這一筆若在停損價出場，你願意賠掉的金額"
                value={settings.riskBudget}
                onCommit={(riskBudget) => updateSettings({ riskBudget })}
                min={1}
                integer
              />
              <div className="grid grid-cols-2 gap-4">
                <NumberField
                  label="單檔上限 (%)"
                  hint="1~100"
                  description="一檔最多投入可動用資金的幾成"
                  value={settings.maxPositionPct * 100}
                  onCommit={(pct) => updateSettings({ maxPositionPct: pct / 100 })}
                  min={MIN_POSITION_PCT * 100}
                  max={MAX_ALLOWED_POSITION_PCT * 100}
                />
                <NumberField
                  label="手續費折扣 (折)"
                  hint="1~10"
                  description="跟券商談到的折數。10 折＝無折扣（預設值偏保守）"
                  value={settings.feeDiscount * 10}
                  onCommit={(tenths) => updateSettings({ feeDiscount: tenths / 10 })}
                  min={MIN_FEE_DISCOUNT * 10}
                  max={MAX_FEE_DISCOUNT * 10}
                />
              </div>
            </div>
          )}
        </section>

        {/* Verification Section —— 只在有夠舊的紀錄時出現，見 hasRipeHistory */}
        {hasRipeHistory && (
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
              {verifyOutcomes.isPending
                ? '驗證中...'
                : verifyResults
                  ? '重新對答案'
                  : '對答案'}
            </button>

            {verifyResults?.map(({ ruleVersion, tally, verifiedAt }) => (
              <div
                key={ruleVersion}
                className="mt-6 space-y-4 p-4 bg-background rounded-xl border border-border"
              >
                <div className="space-y-2 pb-3 border-b border-border">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-muted-foreground">達標率</span>
                      <span className="ml-2 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                        規則 v{ruleVersion}
                      </span>
                    </div>
                    {/* 已結案筆數不足時不給百分比。n=1 的 100.0% 先前用
                        text-2xl 印在這裡，還會出現在當天查的每一張卡片上，
                        語氣是「這套規則目前實測」—— 那是全站唯一宣稱
                        「已驗證」的數字，卻是最沒有統計效力的那個。 */}
                    {isConclusive(tally.decided) && tally.targetRate != null ? (
                      <span className="text-2xl font-bold text-foreground">
                        {/* targetRate 後端已經是百分比（3/4 回 75），不可再乘 100 */}
                        {tally.targetRate.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground text-right">
                        樣本不足
                        <span className="block text-[11px]">
                          已結案 {tally.decided} 筆，需 {MIN_DECIDED} 筆
                        </span>
                      </span>
                    )}
                  </div>
                  {/* 成立率必須與達標率並列。達標率的分母只算已分出勝負的筆數，
                      單獨看會讓「大部分計畫從未觸發進場」完全看不見 ——
                      而那決定這個工具實不實用。 */}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground text-sm">計畫成立率</span>
                    <span className="text-lg font-bold">
                      {tally.entryRate != null ? `${tally.entryRate.toFixed(1)}%` : '尚無結論'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    達標率的分母只算已分出勝負的 {tally.decided} 筆；成立率算的是價格確實
                    進入過進場區的 {tally.entered ?? 0} 筆。兩者分母不同，不能相乘。
                    {/* 點估計值不講區間就是在假裝精確。20 筆時區間仍有
                        ±20 個百分點 —— 讓那個寬度自己說話。 */}
                    {isConclusive(tally.decided) &&
                      (() => {
                        const ci = wilson95(tally.target, tally.decided);
                        if (!ci) return null;
                        return (
                          <>
                            {' '}
                            以目前的樣本數，達標率的 95% 信賴區間是{' '}
                            {ci[0].toFixed(0)}%~{ci[1].toFixed(0)}%。
                          </>
                        );
                      })()}
                    {!isConclusive(tally.decided) && (
                      <> 樣本門檻 {MIN_DECIDED} 筆是經驗值，未經驗證。</>
                    )}
                  </p>
                </div>
                {/* 五格而非三格：未進場與同日觸及兩者先前完全沒顯示，
                    OUTCOME_LABEL 早就定義好文字卻沒用上。少了它們，
                    使用者手上 50 筆紀錄而畫面只加得出 10 筆，差額沒有一個字解釋。 */}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-sm">
                  <div className="bg-muted rounded p-2">
                    <div className="text-up font-bold">{tally.target}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['target']}</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-down font-bold">{tally.stop}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['stop']}</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-foreground font-bold">{tally.open}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['open']}</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-muted-foreground font-bold">{tally.noEntry}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['no_entry']}</div>
                  </div>
                  <div className="bg-muted rounded p-2">
                    <div className="text-muted-foreground font-bold">{tally.ambiguous}</div>
                    <div className="text-muted-foreground text-xs mt-1">{OUTCOME_LABEL['ambiguous']}</div>
                  </div>
                </div>

                {/* 結果現在會留著，因此必須標明它是什麼時候跑的 ——
                    否則使用者會把三週前的統計當成現在的命中率。 */}
                <p className="text-[11px] text-muted-foreground">
                  驗證於 {new Date(verifiedAt).toLocaleString('zh-TW')} —— 這是當時的結果，不是即時值
                </p>
              </div>
            ))}
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
            {/* 先前是一個沒有確認、沒有 undo、沒有匯出的紅色小字 ——
                手指滑過就是 50 筆快照沒了，而每一筆都花了 16~20 秒才跑出來，
                且它們是前瞻驗證唯一的輸入。專案裡裝好了 alert-dialog 卻沒用。 */}
            <AlertDialog>
              <AlertDialogTrigger className="text-sm text-destructive hover:underline">
                清除全部
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>清除全部查詢紀錄？</AlertDialogTitle>
                  <AlertDialogDescription>
                    將刪除 {history.length} 筆快照，無法復原。前瞻驗證的達標率也會一併歸零 ——
                    那份統計要重新累積數週才會再出現。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      clearHistory();
                      // 統計的輸入沒了，統計本身就不該留著 —— 否則卡片上
                      // 會繼續印一個無法重驗、也無處可清的達標率。
                      clearVerify();
                      setVerifyResults(null);
                    }}
                  >
                    清除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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

  // 同一組的關鍵字相同，查詢標的自然也相同 —— 取任一筆有記錄的即可。
  // 舊紀錄沒有這個欄位，那時就只顯示關鍵字本身。
  const queriedName = items.find((i) => i.queriedName)?.queriedName ?? null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 flex-wrap">
          {expanded ? <ChevronDown className="w-5 h-5 text-muted-foreground" /> : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
          <span className="text-lg font-bold">{keyword}</span>
          {/* 查個股時關鍵字是一串數字。少了公司名，三天後回頭看只有代號，
              而列裡最顯眼的名字是「領先標的」—— 那通常不是查的那一檔 */}
          {queriedName && (
            <span className="text-lg font-bold text-accent">{queriedName}</span>
          )}
          <span className="text-sm bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{items.length} 筆紀錄</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {items.map(item => (
            <div key={item.id} className="flex items-stretch justify-between hover:bg-muted/10 group">
              {/* 主要動作先前掛在 <div onClick> 上，沒有 role、沒有 tabIndex、
                  也沒有 onKeyDown —— 鍵盤與螢幕閱讀器使用者永遠打不開任何一筆
                  歷史分析。而那一列唯一可聚焦的元素是下面那顆 opacity-0 的
                  刪除鈕：按 Enter 想「打開」，實際是「刪除」。 */}
              <button
                type="button"
                className="flex-1 p-4 text-left cursor-pointer"
                onClick={() => setLocation(`/analysis?snapshotId=${item.id}`)}
              >
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-sm text-muted-foreground">{formatHistoryTime(item.createdAt)}</span>
                  <span className="text-xs border border-border rounded px-1.5 py-0.5 bg-background text-muted-foreground uppercase">{item.period}</span>
                  {item.sentiment === 'bullish' && <span className="text-up text-xs font-medium">▲ 看多</span>}
                  {item.sentiment === 'bearish' && <span className="text-down text-xs font-medium">▼ 看空</span>}
                  {item.sentiment === 'neutral' && <span className="text-foreground text-xs font-medium">● 盤整</span>}
                </div>
                {item.topCode && (
                  <div className="text-sm flex items-center gap-2">
                    <span className="text-muted-foreground">領先標的:</span>
                    <span className="font-bold text-accent">{item.topName} ({item.topCode})</span>
                    {item.topEv != null && (
                      <span className={`font-mono font-medium ${item.topEv >= 0 ? 'text-up' : 'text-down'}`}>
                        E(V) {item.topEv > 0 ? '+' : ''}{(item.topEv).toFixed(2)}%
                      </span>
                    )}
                  </div>
                )}
              </button>
              {/* opacity-0 不會關掉 pointer events —— 這顆按鈕先前在手機上是
                  「看不見但完全點得到」，手指落在列的右緣就靜默刪掉一筆花了
                  16~20 秒才跑出來的分析，沒有確認也沒有 undo。
                  改成只在真的支援 hover 的裝置上才隱藏，並補上可讀名稱與
                  44px 觸控區。 */}
              <button
                type="button"
                aria-label={`刪除 ${formatHistoryTime(item.createdAt)} 這筆紀錄`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.id);
                }}
                className="m-2 p-2 min-w-11 min-h-11 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-all [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
