import React from 'react';
import { StockInfo, StockDetailResult } from '@workspace/api-client-react';
import { deriveAdvice, deriveInvalidation } from '@workspace/advice';
import { RiskSettings, planPosition } from '@/lib/settings';
import { lotEconomics, roundTripCostPct, SHARES_PER_LOT } from '@/lib/fees';
import { TrendingUp, AlertTriangle, Info, Target, ShieldAlert, ArrowRight, ShieldCheck, ExternalLink } from 'lucide-react';
import { AdviceBanner } from '@/components/stock/advice-banner';
import { ChipsPanel } from '@/components/stock/chips-panel';
import { SignalList } from '@/components/stock/signal-list';
import { DataFreshness } from '@/components/data-freshness';
import { strategyFor } from '@/lib/strategy';
import type { StoredVerify } from '@/lib/verifyStore';
import { MarketPanel } from '@/components/stock/market-panel';
import type { GroupRank } from '@/lib/groupStrength';

interface StockCardProps {
  stock: StockInfo;
  detail?: StockDetailResult;
  loading: boolean;
  settings: RiskSettings;
  /** 這張卡片所屬規則版本的實際驗證結果。null 代表尚未累積到可驗證的紀錄 */
  verified?: StoredVerify | null;
  /** 同一條供應鏈內的相對強弱排名。null 代表無可比對象 */
  groupRank?: GroupRank | null;
}

export function StockCard({
  stock,
  detail,
  loading,
  settings,
  verified,
  groupRank,
}: StockCardProps) {
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
    advice,
    currentPrice,
    priceAsOf,
    chipsAsOf,
    revenueAsOf,
    period,
    avgVolume20,
    chips,
    signals,
    trend,
    trendBasis,
    volume,
    invalidation,
    stopBasis,
    narrative,
    swingLow,
    returns,
    relativeStrength,
    market,
  } = detail;

  // 舊快照存的時候還沒有 advice 這個欄位。deriveAdvice 是純函式，
  // 用當時存下來的價位重算，得到的就是當時該顯示的狀態 ——
  // 少了這一步，部署前存的查詢紀錄仍會把「站回月線後才成立」的價位
  // 當成現在的建議買價印出來，那正是這次要修掉的東西。
  const effectiveAdvice =
    advice ??
    deriveAdvice({
      currentPrice: currentPrice ?? null,
      entryLow: entryLow ?? null,
      entryHigh: entryHigh ?? null,
      stopLoss: stopLoss ?? null,
    });

  // 與 advice 同樣的理由：舊快照沒有 invalidation 欄位，用快照存下的價位
  // 自行補算。deriveInvalidation 是純函式，算出來的就是當時該顯示的內容。
  const effectiveInvalidation =
    invalidation ??
    deriveInvalidation({
      planKind: effectiveAdvice.planKind,
      stopLoss: stopLoss ?? null,
      swingLow: swingLow ?? null,
      period: period ?? null,
    });

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

  // 實際到手的賠率。後端的 riskRewardRatio 是毛值、用價差算的，而下單要付
  // 兩趟手續費與一趟證交稅 —— 畫面只印毛值等於系統性地把每一筆交易
  // 講得比實際好。停損距離為 0（缺價位）時不給比值，不輸出 Infinity。
  const netRiskReward =
    economics && economics.netRiskPerLot > 0
      ? economics.netRewardPerLot / economics.netRiskPerLot
      : null;

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
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <h3 className="text-xl font-bold text-foreground">{stock.name}</h3>
              <span className="text-lg text-muted-foreground font-mono">{stock.code}</span>
              {/* 現價要能一眼看到。先前它只出現在操作建議的句子裡，
                  想知道「現在多少錢」得先讀完一句話。 */}
              {currentPrice != null && (
                <span className="flex items-baseline gap-1">
                  <span className="text-xl font-bold font-mono text-foreground">{currentPrice}</span>
                  <span className="text-xs text-muted-foreground">收盤</span>
                </span>
              )}
              <span className="px-2 py-0.5 bg-accent/20 text-accent text-xs font-medium rounded border border-accent/20">
                {stock.sector}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{stock.reason}</p>
            <div className="mt-2 space-y-1">
              <span className="inline-block px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded border border-border">
                {strategyFor(period).label} · {strategyFor(period).detail}
              </span>
              <DataFreshness
                priceAsOf={priceAsOf}
                chipsAsOf={chipsAsOf}
                revenueAsOf={revenueAsOf}
              />
            </div>
            {stock.reasonSource != null && (
              <span className="inline-flex items-center gap-1 text-xs text-accent mt-2 bg-accent/10 px-2 py-0.5 rounded">
                <ExternalLink className="w-3 h-3" />
                新聞出處 #{stock.reasonSource}
              </span>
            )}
          </div>
          {/* planKind 為 none 時整個訊號徽章不顯示。
              評分算的是「這份交易計畫的期望值」，而 none 代表現價已跌破停損
              或缺少必要價位 —— 那份計畫的前提根本不存在，分數自然無從解讀。
              一檔剛跳空跌破雙均線的高成長股仍可能算出「強烈買進」，
              與同一張卡片上的「已跌破停損，不建議進場」直接互相矛盾。
              評分規則本身屬第二階段，這裡只在前提不成立時不陳述結論。 */}
          {evSignal && effectiveAdvice.planKind !== 'none' && (
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
          
          {/* 實際達標率印在 E(V) 正下方。E(V) 是由一張未經回測的機率表算出來的
              （README「判斷層與計算層分開陳述」那一節有標示），而前瞻驗證是唯一
              能校正那個印象的東西 —— 它先前只出現在首頁，等於把宣稱與檢驗
              放在兩個不同的畫面上。 */}
          {verified?.tally.targetRate != null && (
            <div className="text-xs bg-muted/40 border border-border rounded px-2 py-1.5 leading-relaxed">
              <span className="text-muted-foreground">這套規則（v{verified.ruleVersion}）目前實測：</span>
              <span className="font-bold text-foreground"> 達標率 {verified.tally.targetRate.toFixed(1)}%</span>
              <span className="text-muted-foreground">（已結案 {verified.tally.decided} 筆）</span>
              {verified.tally.entryRate != null && (
                <span className="text-muted-foreground">
                  ，計畫成立率 {verified.tally.entryRate.toFixed(1)}%
                </span>
              )}
            </div>
          )}

          <div className="space-y-2">
            <ScenarioBar label="多頭" p={pBull} r={rBull} color="bg-primary" />
            <ScenarioBar label="基準" p={pBase} r={rBase} color="bg-muted-foreground" />
            <ScenarioBar label="空頭" p={pBear} r={rBear} color="bg-destructive" />
          </div>
        </div>

        {/* Financial Metrics */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="MA 位置" value={formatMaSignal(maSignal)} />
            <MetricCard
              label="月營收 YoY"
              value={revenueYoY != null ? `${revenueYoY > 0 ? '+' : ''}${revenueYoY.toFixed(1)}%` : '-'}
              isPositive={revenueYoY ? revenueYoY > 0 : undefined}
            />
            {/* 20 日均量後端一直有算，只是從來沒顯示。缺了它，一張再漂亮的計畫
                也看不出掛不掛得進去 —— 小型股的流動性是能不能成交的前提。
                有量能剖面時改顯示當日量與倍數：只給均量回答不了
                「今天的量算不算異常」。 */}
            {volume ? (
              <MetricCard
                label={`當日量（均量 ${formatVolumeRatio(volume.ratio)}）`}
                value={formatVolume(volume.latest)}
                isPositive={volume.kind === 'surge' ? true : undefined}
              />
            ) : (
              <MetricCard label="20日均量" value={formatVolume(avgVolume20)} />
            )}
            {/* 舊快照沒有 chips 欄位，退回原本的單一累積數字。
                這裡的天期標示刻意寫「約24日」而非「30日」—— 舊資料抓的是
                35 個日曆日，從來就不是 30 個交易日。 */}
            {!chips && <MetricCard label="外資（約24日）" value={formatInstitutional(foreignNet30d)} />}
            {!chips && <MetricCard label="投信（約24日）" value={formatInstitutional(trustNet30d)} />}
          </div>
          {/* 相對強弱排在籌碼之前：它回答的是「這檔到底強不強」，
              而籌碼是解釋強弱成因的其中一個面向。 */}
          <MarketPanel
            returns={returns}
            relativeStrength={relativeStrength}
            market={market}
            groupRank={groupRank}
          />
          {chips && <ChipsPanel chips={chips} chipsAsOf={chipsAsOf} />}
          <SignalList signals={signals} trend={trend} trendBasis={trendBasis} />
        </div>
      </div>

      {/* Trading Plan */}
      <div className="p-5 bg-background/50 flex-1 space-y-4">
        <AdviceBanner
          advice={effectiveAdvice}
          currentPrice={currentPrice}
          entryLow={entryLow}
          entryHigh={entryHigh}
          stopLoss={stopLoss}
          priceAsOf={priceAsOf}
        />

        {/* 摘要由已算出的欄位模板組句，不呼叫模型 —— 因此永遠不會與
            下方的數字牴觸。模型敘述做不到這一點，而它就印在數字旁邊。 */}
        {narrative && (
          <p className="text-sm leading-relaxed text-foreground/90 bg-muted/30 border border-border rounded-lg p-3">
            {narrative}
          </p>
        )}

        <h4 className="text-sm font-bold text-muted-foreground flex items-center gap-2">
          <Target className="w-4 h-4" />
          {/* 區間在現價之上時那組價位講的是「假如站回月線之後」，
              沿用「交易計畫」這個標題就是使用者看到矛盾數字的原因 */}
          {effectiveAdvice.planKind === 'conditional' ? '站回月線後的計畫（尚未成立）' : '交易計畫'}
        </h4>

        {/* planKind 為 none 代表現價已跌破停損或資料不足 —— 那組價位的前提
            已經不存在，印出來只會誤導，整塊不顯示 */}
        {effectiveAdvice.planKind === 'none' ? (
          <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            目前不提供進場區間與停損停利
          </div>
        ) : entryLow && entryHigh && stopLoss && takeProfit ? (
          <div className="space-y-5">
            {/* Price Levels */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  {effectiveAdvice.planKind === 'conditional' ? '成立後進場區' : '進場區間'}
                </div>
                <div className="font-mono font-medium text-foreground">{entryLow} - {entryHigh}</div>
              </div>
              <div>
                <div className="text-xs text-destructive mb-1 flex items-center gap-1"><ShieldAlert className="w-3 h-3"/> 停損</div>
                <div className="font-mono font-medium text-destructive">{stopLoss}</div>
                {/* 只給一個數字，使用者無從判斷這個停損是踩在結構上還是懸空的 ——
                    同樣是 115 元，落在近 20 日低點之下與之上，被掃出場的機率完全不同 */}
                {stopBasis && (
                  <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    {stopBasis.text}
                    {(stopBasis.reference?.swingLow != null || stopBasis.reference?.ma20 != null) && (
                      <>
                        <br />
                        對照：
                        {stopBasis.reference.swingLow != null && `近20日低 ${stopBasis.reference.swingLow}`}
                        {stopBasis.reference.swingLow != null && stopBasis.reference.ma20 != null && '、'}
                        {stopBasis.reference.ma20 != null && `月線 ${stopBasis.reference.ma20}`}
                      </>
                    )}
                  </div>
                )}
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
                
                {/* 扣費後才是實際到手的賠率，因此排在前面。毛值是價差算出來的，
                    而下單要付兩趟手續費與一趟證交稅 —— 先印毛值等於系統性地
                    把每一筆交易講得比實際好。低價股尤其明顯：手續費有 20 元低收，
                    價差被固定成本吃掉的比例遠高於高價股。 */}
                {netRiskReward != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      風報比（扣費後）:{' '}
                      <strong className={netRiskReward < 1 ? 'text-destructive' : 'text-foreground'}>
                        {netRiskReward.toFixed(2)}
                      </strong>
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1">
                      單張最大虧損: <strong className="text-destructive font-mono">NT$ {economics.netRiskPerLot.toLocaleString(undefined, {maximumFractionDigits:0})}</strong>
                    </span>
                  </div>
                )}

                {/* 毛值保留的價值是「對照」，不是主指標 —— 它讓使用者看得出
                    成本吃掉了多少。放進展開區，預設不與扣費後的數字並排競爭：
                    實測十檔有四檔兩者跨越 1.0，並排時使用者會同時看到
                    「賠率有利」與「賠率不利」兩個結論。 */}
                {riskRewardRatio != null && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer select-none">未扣費用的帳面數字</summary>
                    <div className="mt-1 space-y-0.5 font-mono">
                      <div>帳面風報比：{riskRewardRatio.toFixed(2)}（以價差計算，未計手續費與證交稅）</div>
                      <div>
                        單張淨獲利：NT${' '}
                        {economics.netRewardPerLot.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </details>
                )}

                {/* 賠率警示以**扣費後**的比值為準，不是毛值。
                    成本兩邊都打：它減少獲利、同時放大虧損，而風報比是個比值，
                    分子分母會同時往壞的方向走。實測十檔有四檔因此從
                    「賠率有利」翻成「不利」—— 台積電毛 1.20、淨 0.96。
                    先前警示只看毛值，這四檔正好落在縫裡：畫面把淨值標紅，
                    卻沒有一個字說明發生了什麼事，而那恰恰是最需要說明的一種。 */}
                {netRiskReward != null && netRiskReward < 1 && (
                  <div className="text-xs text-destructive/90 bg-destructive/10 p-2 rounded">
                    {riskRewardRatio != null && riskRewardRatio >= 1 ? (
                      <>
                        ⚠️ 賠率被交易成本翻面：帳面風報比 {riskRewardRatio.toFixed(2)} 看似有利，
                        但扣掉兩趟手續費與證交稅後只剩 {netRiskReward.toFixed(2)}。
                        成本同時吃掉獲利並放大虧損，所以淨值掉得比想像中多。
                        證交稅 0.3% 不能打折，談券商折扣救不回來。
                      </>
                    ) : (
                      <>
                        ⚠️ 風報比低於 1：停利距離比停損距離短，即使方向看對，獲利也小於看錯時的虧損
                        （扣費後為 {netRiskReward.toFixed(2)}）。這筆交易的賠率不利，與現在能否進場無關。
                      </>
                    )}
                  </div>
                )}

                {/* 流動性：建議張數相對日均量的比例。門檻是經驗值、未經驗證，
                    因此只陳述事實比例，由使用者自行判斷掛不掛得進去。 */}
                {position.lots > 0 && avgVolume20 != null && avgVolume20 > 0 && (
                  (() => {
                    const pctOfVolume = ((position.lots * SHARES_PER_LOT) / avgVolume20) * 100;
                    if (pctOfVolume < 1) return null;
                    return (
                      <div className="text-xs text-amber-500/90 bg-amber-500/10 p-2 rounded">
                        ⚠️ 流動性：建議張數約當 20 日均量的 {pctOfVolume.toFixed(1)}%，
                        成交量不足時可能不易以理想價格成交。
                      </div>
                    );
                  })()
                )}
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
                {/* 0 張最需要解釋，先前卻是唯一不解釋的情況 —— 上面兩個提示都被
                    lots > 0 擋掉，使用者只看到「0 張／NT$ 0」，不知道是系統壞了、
                    標的不好、還是自己的設定買不起。這裡把 limitedBy 換成具體門檻。 */}
                {position.lots === 0 && (
                  <div className="text-xs text-amber-500/90 bg-amber-500/10 p-2 rounded space-y-1">
                    {position.limitedBy === 'risk' ? (
                      <>
                        <div>
                          ⚠️ 買不到 1 張：這檔每張最大虧損 NT${' '}
                          {Math.round(economics.netRiskPerLot).toLocaleString()}，超過你設定的單筆風險上限 NT${' '}
                          {settings.riskBudget.toLocaleString()}。
                        </div>
                        <div className="text-muted-foreground">
                          要買 1 張，單筆風險上限需提高到 NT${' '}
                          {Math.ceil(economics.netRiskPerLot).toLocaleString()} 以上；或改用較短的分析週期（停損較近）。
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          ⚠️ 買不到 1 張：1 張成本 NT${' '}
                          {Math.round(position.costPerLot).toLocaleString()}，超過單檔可投入上限 NT${' '}
                          {Math.round(position.capitalCap).toLocaleString()}
                          （資金 {settings.capital.toLocaleString()} × {Math.round(settings.maxPositionPct * 100)}%）。
                        </div>
                        <div className="text-muted-foreground">
                          台股一張 1000 股，本工具尚未支援零股。
                        </div>
                      </>
                    )}
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

            {/* 計畫在什麼情況下不再成立。少了這塊，使用者只知道什麼時候該買，
                不知道什麼時候該承認這次判斷錯了 —— 而後者才是真正會虧錢的那一半。 */}
            <div className="border-l-2 border-border pl-3 space-y-1 text-xs text-muted-foreground">
              <div className="font-bold text-foreground/80">這份計畫何時失效</div>
              <div>{effectiveInvalidation.priceReason}</div>
              <div>{effectiveInvalidation.expiryReason}</div>
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

/** 成交量後端以「股」為單位，畫面一律換算成張（台股一張 1000 股） */
function formatVolume(shares?: number | null) {
  if (shares == null || !Number.isFinite(shares) || shares <= 0) return '-';
  return `${Math.round(shares / 1000).toLocaleString()}張`;
}

/** 當日量相對於 20 日均量的倍數 */
function formatVolumeRatio(ratio?: number | null) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${ratio.toFixed(2)}×`;
}
