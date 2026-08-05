import React from 'react';
import { StockInfo, StockDetailResult } from '@workspace/api-client-react';
import { deriveAdvice, deriveInvalidation } from '@workspace/advice';
import { RiskSettings, planPosition } from '@/lib/settings';
import { lotEconomics, roundTripCostPct, SHARES_PER_LOT } from '@/lib/fees';
import { TrendingUp, AlertTriangle, Info, Target, ArrowRight, ShieldCheck, ExternalLink } from 'lucide-react';
import { AdviceBanner } from '@/components/stock/advice-banner';
import { ChipsPanel } from '@/components/stock/chips-panel';
import { SignalList } from '@/components/stock/signal-list';
import { DataFreshness } from '@/components/data-freshness';
import { strategyFor } from '@/lib/strategy';
import type { StoredVerify } from '@/lib/verifyStore';
import { MarketPanel } from '@/components/stock/market-panel';
import { PriceMap } from '@/components/stock/price-map';
import type { GroupRank } from '@/lib/groupStrength';
import {
  DividendPanel,
  FinancialsPanel,
  ValuationPanel,
} from '@/components/stock/valuation-panel';
import { maSignalText, viewFor, type ViewProfile } from '@workspace/view-profile';

interface StockCardProps {
  stock: StockInfo;
  detail?: StockDetailResult;
  loading: boolean;
  settings: RiskSettings;
  /** 這張卡片所屬規則版本的實際驗證結果。null 代表尚未累積到可驗證的紀錄 */
  verified?: StoredVerify | null;
  /** 同一條供應鏈內的相對強弱排名。null 代表無可比對象 */
  groupRank?: GroupRank | null;
  /** 受眾視圖。決定顯示哪些區塊，不改變任何數字 */
  profile?: ViewProfile;
  /** 這檔就是使用者查的那一檔。查產業關鍵字時每張卡片都是 false */
  isQueried?: boolean;
}

export function StockCard({
  stock,
  detail,
  loading,
  settings,
  verified,
  groupRank,
  profile,
  isQueried,
}: StockCardProps) {
  const view = viewFor(profile);
  const shows = (section: Parameters<typeof view.show.includes>[0]) =>
    view.show.includes(section);
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
    ma20,
    ma60,
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
    swingHigh,
    returns,
    relativeStrength,
    market,
    valuation,
    dividend,
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
            {/* 身分一行、價格一行。先前五個元素擠在同一行，代號與價格兩串
                裸數字直接相鄰（「台燿 6274 1340 收盤」），讀的人得自己猜
                哪一串是代號、哪一串是錢。 */}
            <div className="flex items-center flex-wrap gap-2">
              <h3 className="text-xl font-bold text-foreground">{stock.name}</h3>
              <span className="px-1.5 py-0.5 font-mono text-sm text-muted-foreground bg-background rounded border border-border">
                {stock.code}
              </span>
              <span className="px-2 py-0.5 bg-accent/20 text-accent text-xs font-medium rounded border border-accent/20">
                {stock.sector}
              </span>
              {/* 查個股時這張卡片會被排到第一，徽章說明它為什麼在那裡 */}
              {isQueried && (
                <span className="px-2 py-0.5 bg-primary/15 text-primary text-xs font-bold rounded border border-primary/30">
                  你查的
                </span>
              )}
            </div>
            {/* 現價要能一眼看到。先前它只出現在操作建議的句子裡，
                想知道「現在多少錢」得先讀完一句話。 */}
            {currentPrice != null && (
              <div className="flex items-baseline gap-1.5 mt-1 mb-1">
                <span className="text-xs text-muted-foreground">收盤價</span>
                <span className="text-2xl font-bold font-mono text-foreground">{currentPrice}</span>
              </div>
            )}
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

      {/* 結論層。
          這兩塊先前埋在卡片下半部：操作建議排在整個雙欄格線之後（手機端要滑過
          十來個區塊才看得到），而「最壞會賠多少」躲在部位試算盒的第三行。
          一個回答「能不能買」的畫面，把答案放在證據後面。 */}
      <div className="p-5 border-b border-border space-y-3">
        <AdviceBanner
          advice={effectiveAdvice}
          currentPrice={currentPrice}
          entryLow={entryLow}
          entryHigh={entryHigh}
          stopLoss={stopLoss}
          priceAsOf={priceAsOf}
        />

        {/* 新手視圖的註解寫「那是他唯一該記住的數字」—— 那就不該印在第三層。
            計畫不成立時不顯示：沒有有效停損，這個數字算不出意義。 */}
        {shows('position_sizing') && position && economics && effectiveAdvice.planKind !== 'none' && (
          <div className="flex items-baseline justify-between gap-3 bg-destructive/5 border border-destructive/20 rounded-lg px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {position.lots > 0 ? `照建議買 ${position.lots} 張，最壞會賠` : '每張最壞會賠'}
            </span>
            <span className="text-xl font-bold font-mono text-destructive">
              NT${' '}
              {Math.round(
                position.lots > 0
                  ? economics.netRiskPerLot * position.lots
                  : economics.netRiskPerLot,
              ).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* EV and Scenarios */}
      <div className="p-5 grid md:grid-cols-2 gap-6 border-b border-border">
        {/* EV Result */}
        <div className="space-y-4">
          {/* 先前是 text-3xl font-black，全卡最大的字。而新手視圖砍掉這一項的
              理由正是「那張機率表未經回測」—— 不夠可靠到能給新手看的東西，
              不該在其他視圖當視覺主角。降到與其他佐證同級，顏色留著（正負號
              本身有意義），但不再跟操作建議搶第一眼。 */}
          {shows('expected_value') && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted-foreground font-medium">加權期望值 E(V)</span>
              {ev != null && (
                <span className={`text-xl font-bold font-mono ${ev >= 0 ? 'text-primary' : 'text-destructive'}`}>
                  {ev > 0 ? '+' : ''}{ev.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          {/* 實際達標率印在 E(V) 正下方。E(V) 是由一張未經回測的機率表算出來的
              （README「判斷層與計算層分開陳述」那一節有標示），而前瞻驗證是唯一
              能校正那個印象的東西 —— 它先前只出現在首頁，等於把宣稱與檢驗
              放在兩個不同的畫面上。 */}
          {shows('verified_rate') && verified?.tally.targetRate != null && (
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

          {/* 三情境機率是新手最容易誤讀的東西：「多頭 55%」會被讀成
              「有 55% 機率會賺」，而視覺化強化了那個誤讀。
              收合的第二個理由：E(V) 就是這三條的加權摘要，兩個並排等於
              同一個宣稱講兩次，而它們出自同一張未經回測的機率表。 */}
          {shows('expected_value') && pBull != null && (
            <details className="group">
              <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
                三情境機率與報酬
              </summary>
              <div className="space-y-2 mt-2">
                <ScenarioBar label="多頭" p={pBull} r={rBull} color="bg-primary" />
                <ScenarioBar label="基準" p={pBase} r={rBase} color="bg-muted-foreground" />
                <ScenarioBar label="空頭" p={pBear} r={rBear} color="bg-destructive" />
              </div>
            </details>
          )}

          {/* 動能與新手視圖的左欄原本整片空白 —— 那兩個視圖不看 E(V)、
              不看三情境、也不看估值，於是這一欄什麼都沒有而右欄是滿的。
              價位地圖填的是這個洞，同時回答單看數字答不出來的事：
              進場區壓在月線之上還是之下、現價離停損還有多遠。 */}
          {shows('price_map') && (
            <PriceMap
              planKind={effectiveAdvice.planKind}
              // 新手視圖右欄把均線翻成白話，地圖不跟上就會在同一張卡片上
              // 出現兩套詞講同一件事
              glossary={view.glossary}
              currentPrice={currentPrice}
              entryLow={entryLow}
              entryHigh={entryHigh}
              stopLoss={stopLoss}
              takeProfit={takeProfit}
              // 1R 與移動停損是進階術語，新手視圖不講。先前這兩個價位在卡片底下
              // 有自己的灰籤並受 trailing_stop 控制，但地圖無條件把「第一目標」
              // 畫給所有人看 —— 同一個決定在兩個地方講反了。
              firstTarget={shows('trailing_stop') ? firstTarget : null}
              trailingStop={shows('trailing_stop') ? trailingStop : null}
              ma20={ma20}
              ma60={ma60}
              swingHigh={swingHigh}
              swingLow={swingLow}
            />
          )}

          {/* 估值三塊只有價值與存股視圖看得到。財報走延後載入 ——
              只有真的切到那些視圖時才發請求。 */}
          {shows('valuation') && <ValuationPanel valuation={valuation} />}
          {shows('dividend') && <DividendPanel dividend={dividend} />}
          {shows('financials') && <FinancialsPanel code={code} enabled={shows('financials')} />}
        </div>

        {/* Financial Metrics */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {/* 新手視圖用白話文講同一個判斷 —— 只換用詞，不改判斷本身 */}
            {shows('ma_position') && (
              <MetricCard label="均線位置" value={maSignalText(maSignal, view.glossary)} />
            )}
            {shows('monthly_yoy') && (
              <MetricCard
                label="月營收 YoY"
                value={revenueYoY != null ? `${revenueYoY > 0 ? '+' : ''}${revenueYoY.toFixed(1)}%` : '-'}
                isPositive={revenueYoY ? revenueYoY > 0 : undefined}
              />
            )}
            {/* 20 日均量後端一直有算，只是從來沒顯示。缺了它，一張再漂亮的計畫
                也看不出掛不掛得進去 —— 小型股的流動性是能不能成交的前提。
                有量能剖面時改顯示當日量與倍數：只給均量回答不了
                「今天的量算不算異常」。 */}
            {shows('volume') &&
              (volume ? (
                <MetricCard
                  label={`當日量（均量 ${formatVolumeRatio(volume.ratio)}）`}
                  value={formatVolume(volume.latest)}
                  isPositive={volume.kind === 'surge' ? true : undefined}
                />
              ) : (
                <MetricCard label="20日均量" value={formatVolume(avgVolume20)} />
              ))}
            {/* 舊快照沒有 chips 欄位，退回原本的單一累積數字。
                這裡的天期標示刻意寫「約24日」而非「30日」—— 舊資料抓的是
                35 個日曆日，從來就不是 30 個交易日。 */}
            {shows('chips') && !chips && (
              <MetricCard label="外資（約24日）" value={formatInstitutional(foreignNet30d)} />
            )}
            {shows('chips') && !chips && (
              <MetricCard label="投信（約24日）" value={formatInstitutional(trustNet30d)} />
            )}
          </div>
          {/* 相對強弱排在籌碼之前：它回答的是「這檔到底強不強」，
              而籌碼是解釋強弱成因的其中一個面向。 */}
          {shows('market_strength') && (
            <MarketPanel
              returns={returns}
              relativeStrength={relativeStrength}
              market={market}
              groupRank={groupRank}
            />
          )}
          {shows('chips') && chips && <ChipsPanel chips={chips} chipsAsOf={chipsAsOf} />}
          {shows('signals') && (
            <SignalList
              signals={signals}
              trend={trend}
              trendBasis={shows('signal_details') ? trendBasis : undefined}
              showDetails={shows('signal_details')}
            />
          )}
        </div>
      </div>

      {/* Trading Plan */}
      <div className="p-5 bg-background/50 flex-1 space-y-4">
        {/* 摘要由已算出的欄位模板組句，不呼叫模型 —— 因此永遠不會與
            下方的數字牴觸。模型敘述做不到這一點，而它就印在數字旁邊。 */}
        {shows('narrative') && narrative && (
          <p className="text-sm leading-relaxed text-foreground/90 bg-muted/30 border border-border rounded-lg p-3">
            {narrative}
          </p>
        )}

        {/* 整個交易計畫區塊只在會用到它的視圖顯示。價值與存股看不到 ——
            停損停利與長期持有邏輯牴觸：那兩種投資人的賣出條件是基本面
            轉壞或估值過高，不是價格觸及某個數字。 */}
        {shows('trading_plan') && (
          <>
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
            {/* 進場區、停損、停利的數字先前印在這裡的三欄格線上，而同一組數字
                在上方的價位地圖是刻度標籤、在下方又有「第一目標 (1R)」與
                「移動停損起始」兩個灰籤 —— 一張卡片講三次。地圖是唯一能同時
                回答「多少錢」與「相對月線在哪」的那一份，其餘兩份刪掉。

                停損依據留下來但收合：它回答的是「這個停損是踩在結構上還是懸空的」，
                重要，但不是每次看卡片都要讀的東西。 */}
            {stopBasis && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">停損 {stopLoss} 是怎麼算出來的</summary>
                <div className="mt-1 leading-relaxed">
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
              </details>
            )}

            {/* Position Sizing */}
            {shows('position_sizing') && position && economics && (
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

            {/* 計畫在什麼情況下不再成立。少了這塊，使用者只知道什麼時候該買，
                不知道什麼時候該承認這次判斷錯了 —— 而後者才是真正會虧錢的那一半。
                既然如此，它就不該是全卡最小最灰的一塊。 */}
            {shows('invalidation') && (
              <div className="border-l-2 border-destructive/40 bg-destructive/5 rounded-r-lg pl-3 pr-3 py-2.5 space-y-1">
                <div className="text-sm font-bold text-foreground">這份計畫何時失效</div>
                <div className="text-xs text-foreground/80">{effectiveInvalidation.priceReason}</div>
                <div className="text-xs text-foreground/80">{effectiveInvalidation.expiryReason}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            無足夠數據生成完整交易計畫
          </div>
        )}
          </>
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
