const RISK_BUDGET_KEY = 'risk_budget_per_trade_v1';
const CAPITAL_KEY = 'total_capital_v1';
const MAX_POSITION_PCT_KEY = 'max_position_pct_v1';
const FEE_DISCOUNT_KEY = 'fee_discount_v1';

/**
 * 單筆最大虧損（元）：這一筆若在停損價出場，你願意賠掉的金額。
 * 不是本金，也不是總風險預算，就是單一筆交易的認賠上限。
 */
export const DEFAULT_RISK_BUDGET = 20000;

/**
 * 可動用資金（元）：帳戶裡現在能拿來買股票的現金。
 *
 * 刻意不用「總資產」—— 已經套在持股上的錢買不了新標的，
 * 用總資產會高估可投入金額，算出買不起的張數。
 */
export const DEFAULT_CAPITAL = 1000000;

/**
 * 單一標的最多投入可動用資金的比例 —— 避免一檔押太重。
 *
 * 集中操作者可調高，分散操作者調低，因此做成可設定而非寫死。
 * 以小數儲存（0.3 = 30%），畫面上以百分比呈現。
 */
export const DEFAULT_MAX_POSITION_PCT = 0.3;

/** 允許的設定範圍：至少 1%，最多 100%（全押） */
export const MIN_POSITION_PCT = 0.01;
export const MAX_ALLOWED_POSITION_PCT = 1;

/**
 * 券商手續費折扣倍率：1 = 無折扣（牌告 0.1425%），0.6 = 6 折，0.28 = 2.8 折。
 *
 * 預設無折扣是刻意的保守值：折扣是每個人跟券商談的，猜錯會低估成本，
 * 而低估成本會讓看起來能賺的交易實際上是賠的。
 */
export const DEFAULT_FEE_DISCOUNT = 1;

/** 市面最低約 1 折，再低不合實際；上限 1 即無折扣 */
export const MIN_FEE_DISCOUNT = 0.1;
export const MAX_FEE_DISCOUNT = 1;

/** 台股一張 = 1000 股 */
const SHARES_PER_LOT = 1000;

/**
 * 單筆交易可承受的最大損失（新台幣元）。
 *
 * 設一次、全域套用：手機上逐檔輸入太痛苦，而風險預算本來就是個人設定，
 * 不會因為看哪一檔股票而改變。
 */
export async function loadRiskBudget(): Promise<number> {
  try {
    const raw = localStorage.getItem(RISK_BUDGET_KEY);
    if (!raw) return DEFAULT_RISK_BUDGET;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_RISK_BUDGET;
  } catch {
    return DEFAULT_RISK_BUDGET;
  }
}

export async function saveRiskBudget(value: number): Promise<void> {
  if (!Number.isFinite(value) || value <= 0) return;
  localStorage.setItem(RISK_BUDGET_KEY, String(Math.round(value)));
}

export async function loadCapital(): Promise<number> {
  try {
    const raw = localStorage.getItem(CAPITAL_KEY);
    if (!raw) return DEFAULT_CAPITAL;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAPITAL;
  } catch {
    return DEFAULT_CAPITAL;
  }
}

export async function saveCapital(value: number): Promise<void> {
  if (!Number.isFinite(value) || value <= 0) return;
  localStorage.setItem(CAPITAL_KEY, String(Math.round(value)));
}

/** 單檔上限以小數儲存（0.3 = 30%） */
export async function loadMaxPositionPct(): Promise<number> {
  try {
    const raw = localStorage.getItem(MAX_POSITION_PCT_KEY);
    if (!raw) return DEFAULT_MAX_POSITION_PCT;
    const value = Number(raw);
    return Number.isFinite(value) && value >= MIN_POSITION_PCT && value <= MAX_ALLOWED_POSITION_PCT
      ? value
      : DEFAULT_MAX_POSITION_PCT;
  } catch {
    return DEFAULT_MAX_POSITION_PCT;
  }
}

export async function saveMaxPositionPct(value: number): Promise<void> {
  if (!Number.isFinite(value)) return;
  if (value < MIN_POSITION_PCT || value > MAX_ALLOWED_POSITION_PCT) return;
  localStorage.setItem(MAX_POSITION_PCT_KEY, String(value));
}

/** 手續費折扣以倍率儲存（0.6 = 6 折），畫面上以「折」呈現 */
export async function loadFeeDiscount(): Promise<number> {
  try {
    const raw = localStorage.getItem(FEE_DISCOUNT_KEY);
    if (!raw) return DEFAULT_FEE_DISCOUNT;
    const value = Number(raw);
    return Number.isFinite(value) && value >= MIN_FEE_DISCOUNT && value <= MAX_FEE_DISCOUNT
      ? value
      : DEFAULT_FEE_DISCOUNT;
  } catch {
    return DEFAULT_FEE_DISCOUNT;
  }
}

export async function saveFeeDiscount(value: number): Promise<void> {
  if (!Number.isFinite(value)) return;
  if (value < MIN_FEE_DISCOUNT || value > MAX_FEE_DISCOUNT) return;
  localStorage.setItem(FEE_DISCOUNT_KEY, String(value));
}

export type RiskSettings = {
  riskBudget: number;
  capital: number;
  maxPositionPct: number;
  feeDiscount: number;
};

export const DEFAULT_RISK_SETTINGS: RiskSettings = {
  riskBudget: DEFAULT_RISK_BUDGET,
  capital: DEFAULT_CAPITAL,
  maxPositionPct: DEFAULT_MAX_POSITION_PCT,
  feeDiscount: DEFAULT_FEE_DISCOUNT,
};

/** 一次讀齊所有設定，畫面只需要處理一個物件 */
export async function loadRiskSettings(): Promise<RiskSettings> {
  const [riskBudget, capital, maxPositionPct, feeDiscount] = await Promise.all([
    loadRiskBudget(),
    loadCapital(),
    loadMaxPositionPct(),
    loadFeeDiscount(),
  ]);
  return { riskBudget, capital, maxPositionPct, feeDiscount };
}

export type PositionPlan = {
  lots: number;
  /** 是哪一個上限決定了張數，讓畫面能說明為何買不了更多 */
  limitedBy: 'risk' | 'capital';
  costPerLot: number;
  cost: number;
  risk: number;
  pctOfCapital: number;
  capitalCap: number;
};

/**
 * 同時受風險與資金兩個上限節制，取較嚴格者。
 *
 * 只看風險會出事：停損很近的高價股算出來可以買很多張，但一張就要數十萬，
 * 根本買不起、或買了會讓單一標的佔掉大半資金。
 * 兩者皆無條件捨去 —— 寧可少買一張，也不要因進位而超出上限。
 */
export function planPosition(opts: {
  riskBudget: number;
  capital: number;
  riskPerLot: number | null | undefined;
  entryPrice: number | null | undefined;
  /** 單檔上限（小數）。未提供時採預設值。 */
  maxPositionPct?: number;
}): PositionPlan | null {
  const { riskBudget, capital, riskPerLot, entryPrice } = opts;
  if (!riskPerLot || riskPerLot <= 0) return null;
  if (!entryPrice || entryPrice <= 0) return null;
  if (!Number.isFinite(riskBudget) || riskBudget <= 0) return null;
  if (!Number.isFinite(capital) || capital <= 0) return null;

  const pct =
    Number.isFinite(opts.maxPositionPct) &&
    (opts.maxPositionPct as number) >= MIN_POSITION_PCT &&
    (opts.maxPositionPct as number) <= MAX_ALLOWED_POSITION_PCT
      ? (opts.maxPositionPct as number)
      : DEFAULT_MAX_POSITION_PCT;

  const costPerLot = entryPrice * SHARES_PER_LOT;
  const capitalCap = capital * pct;
  const byRisk = Math.floor(riskBudget / riskPerLot);
  const byCapital = Math.floor(capitalCap / costPerLot);
  const lots = Math.max(0, Math.min(byRisk, byCapital));

  return {
    lots,
    limitedBy: byRisk <= byCapital ? 'risk' : 'capital',
    costPerLot,
    cost: lots * costPerLot,
    risk: lots * riskPerLot,
    pctOfCapital: (lots * costPerLot / capital) * 100,
    capitalCap,
  };
}
