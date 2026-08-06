/**
 * 前瞻驗證：拿當初存下的交易計畫，對照事後真實走勢，判定停利與停損哪一個先被觸及。
 *
 * 為什麼需要這個：三情境機率（0.60/0.30/0.10 那五段）與評分權重全是憑經驗訂的，
 * 從未驗證。回測要處理選股偏誤與過度配適，而前瞻紀錄沒有這些問題 ——
 * 計畫是當時就存下來的，事後只是去對答案。累積數月後就有真實命中率可以對照那張機率表。
 *
 * 純計算，不碰網路，因此每一種判定都可以用固定的 K 線資料測試。
 */

export interface Bar {
  date: string;
  /** 當日最高 */
  max: number;
  /** 當日最低 */
  min: number;
  close: number;
}

export type OutcomeKind =
  /** 先觸及停利 */
  | "target"
  /** 先觸及停損 */
  | "stop"
  /** 同一根 K 線同時觸及兩者，日線無法判定先後 */
  | "ambiguous"
  /** 已進場，兩者都還沒觸及 */
  | "open"
  /** 價格從未進入進場區間，這筆計畫沒有成立 */
  | "no_entry"
  /** 資料不足，無法判定 */
  | "unknown";

export interface OutcomeResult {
  kind: OutcomeKind;
  /** 進場成立的日期 */
  entryDate: string | null;
  /** 停利或停損被觸及的日期 */
  exitDate: string | null;
  /** 進場後經過的交易日數 */
  barsHeld: number;
  /** 進場後的最大有利波動（%），以進場中值為基準 */
  maxFavorablePct: number | null;
  /** 進場後的最大不利波動（%），負值 */
  maxAdversePct: number | null;
}

const EMPTY: OutcomeResult = {
  kind: "unknown",
  entryDate: null,
  exitDate: null,
  barsHeld: 0,
  maxFavorablePct: null,
  maxAdversePct: null,
};

export interface PlanToVerify {
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
}

/**
 * 一次除權息造成的價格斷層。
 *
 * `drop` 直接取 FinMind DividendResultRow 的 before_price − after_price ——
 * 那是交易所公告的除息參考價落差，不必自己從現金股利推算，也自動涵蓋除權。
 */
export interface ExDividend {
  /** 除息交易日（YYYY-MM-DD） */
  date: string;
  /** 除息前收盤價減除息參考價 */
  drop: number;
}

/**
 * 判定一筆計畫的結果。
 *
 * 進場條件也一併驗證：計畫寫的是「等回檔到 entryLow~entryHigh 才進場」，
 * 所以必須先找到價格確實進入該區間的那一天。若從未進入，結果是 no_entry ——
 * 把這種情況算成停損或達標都是錯的，那筆交易根本沒發生。
 *
 * 進場成立當日不判定出場：同一根日線既碰到進場區又碰到停損時，無法得知盤中順序，
 * 硬要判定就是在猜。從次一根起算。
 *
 * 同一根 K 線同時觸及停利與停損時回 ambiguous 而非二選一 —— 日線資料就是不知道，
 * 猜一個會讓統計出來的命中率偏向猜的那一邊。
 */
export function evaluateOutcome(
  bars: Bar[],
  plan: PlanToVerify,
  dividends?: ReadonlyArray<ExDividend>,
): OutcomeResult {
  const usable = bars.filter(
    (b) => Number.isFinite(b.max) && Number.isFinite(b.min) && b.max >= b.min,
  );
  if (usable.length === 0) return EMPTY;

  const { entryLow, entryHigh, stopLoss, takeProfit } = plan;
  if (!(entryLow > 0) || !(entryHigh >= entryLow)) return EMPTY;
  if (!(stopLoss > 0) || !(takeProfit > stopLoss)) return EMPTY;

  /**
   * 把除息造成的價格斷層加回去。
   *
   * 抓回來的是原始股價（TaiwanStockPrice），除息當天整條序列會往下跳一個
   * 股利的幅度。持有的人拿到的是現金，不是虧損 —— 但 bar.min 確實跌破了
   * 停損價，於是一筆配息會被判成 "stop"。台股除息季集中在 7~9 月，而
   * 達標率是這個產品用來校正那張未經回測機率表的唯一手段，這個誤判會
   * 系統性地把它壓低。
   *
   * 只採計序列**開始之後**的除息：更早的那些已經內含在整段序列裡，
   * 當初做這份計畫時看到的價位也已經反映過了。
   */
  const seriesStart = usable[0]!.date;
  const applicable = (dividends ?? [])
    .filter((d) => typeof d.date === "string" && d.date > seriesStart && d.drop > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  /** 這根 K 線要加回多少才回到計畫當時的價格尺度 */
  const offsetAt = (date: string): number =>
    applicable.reduce((sum, d) => (d.date <= date ? sum + d.drop : sum), 0);

  // 價格區間與進場區間有重疊即視為可成交
  const entryIndex = usable.findIndex((b) => {
    const off = offsetAt(b.date);
    return b.min + off <= entryHigh && b.max + off >= entryLow;
  });
  if (entryIndex === -1) {
    return { ...EMPTY, kind: "no_entry" };
  }

  const entryBar = usable[entryIndex]!;
  const entryMid = (entryLow + entryHigh) / 2;
  const after = usable.slice(entryIndex + 1);

  let maxHigh = entryBar.max + offsetAt(entryBar.date);
  let minLow = entryBar.min + offsetAt(entryBar.date);
  let kind: OutcomeKind = "open";
  let exitDate: string | null = null;
  let barsHeld = 0;

  for (const bar of after) {
    barsHeld += 1;
    const off = offsetAt(bar.date);
    const high = bar.max + off;
    const low = bar.min + off;
    maxHigh = Math.max(maxHigh, high);
    minLow = Math.min(minLow, low);

    const hitTarget = high >= takeProfit;
    const hitStop = low <= stopLoss;

    if (hitTarget && hitStop) {
      kind = "ambiguous";
      exitDate = bar.date;
      break;
    }
    if (hitTarget) {
      kind = "target";
      exitDate = bar.date;
      break;
    }
    if (hitStop) {
      kind = "stop";
      exitDate = bar.date;
      break;
    }
  }

  return {
    kind,
    entryDate: entryBar.date,
    exitDate,
    barsHeld,
    maxFavorablePct: ((maxHigh - entryMid) / entryMid) * 100,
    maxAdversePct: ((minLow - entryMid) / entryMid) * 100,
  };
}

export interface OutcomeTally {
  target: number;
  stop: number;
  ambiguous: number;
  open: number;
  noEntry: number;
  unknown: number;
  /** 已分出勝負的筆數（達標 + 停損），命中率的分母 */
  decided: number;
  /** 達標率；decided 為 0 時為 null，不顯示 0% 假裝有結論 */
  targetRate: number | null;
  /** 真的進場的筆數（達標＋停損＋同日觸及＋仍持有），成立率的分子 */
  entered: number;
  /**
   * 成立率（%）—— 計畫中有多少比例真的變成交易。
   *
   * 達標率的分母刻意排除了未進場的計畫，那在統計上正確；但少了這個數字，
   * 「大部分計畫從未成立」這件事在畫面上完全看不見，而它決定這個工具的
   * 實用價值：40 筆從未成立、6 筆達標、4 筆停損，達標率是漂亮的 60%，
   * 實際上只有五分之一的計畫變成交易。
   * 可判定筆數為 0 時為 null，不以 0% 假裝有結論。
   */
  entryRate: number | null;
}

/**
 * 彙總多筆結果。
 *
 * 命中率的分母只算已分出勝負的筆數：把「仍持有」與「未進場」放進分母會低估達標率，
 * 放進分子則會高估。ambiguous 兩邊都不進 —— 不知道就是不知道。
 */
export function tallyOutcomes(results: Array<{ kind: OutcomeKind }>): OutcomeTally {
  const tally: OutcomeTally = {
    target: 0,
    stop: 0,
    ambiguous: 0,
    open: 0,
    noEntry: 0,
    unknown: 0,
    decided: 0,
    targetRate: null,
    entered: 0,
    entryRate: null,
  };

  for (const { kind } of results) {
    if (kind === "target") tally.target += 1;
    else if (kind === "stop") tally.stop += 1;
    else if (kind === "ambiguous") tally.ambiguous += 1;
    else if (kind === "open") tally.open += 1;
    else if (kind === "no_entry") tally.noEntry += 1;
    else tally.unknown += 1;
  }

  tally.decided = tally.target + tally.stop;
  tally.targetRate =
    tally.decided > 0 ? Math.round((tally.target / tally.decided) * 1000) / 10 : null;

  // 成立＝價格確實進入過進場區，因此仍持有與同日觸及兩者都算 —— 那些交易
  // 確實發生了。unknown 是「判不出來」，兩邊都不進，與 ambiguous 不進
  // 達標率分母同一個原則：不知道就是不知道。
  tally.entered = tally.target + tally.stop + tally.ambiguous + tally.open;
  const entryDecided = tally.entered + tally.noEntry;
  tally.entryRate =
    entryDecided > 0 ? Math.round((tally.entered / entryDecided) * 1000) / 10 : null;

  return tally;
}
