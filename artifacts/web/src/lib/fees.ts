/**
 * 台股交易成本。
 *
 * 價格層面不含費用（價格就是價格），但所有「金額」都經過本模組換算成淨額，
 * 畫面上因此只會有一組數字，而且是實際到手的那組。
 *
 * 券商折扣以參數傳入而非寫死：未折扣的標準費率會高估成本約 0.2 個百分點，
 * 對於停損很近的短波段，那已足以讓「淨賺」與「淨賠」易位。預設 1（無折扣）
 * 維持保守，設定後才變成使用者自己的實際費率。
 */

/** 台股一張 = 1000 股 */
export const SHARES_PER_LOT = 1000;

/** 券商手續費率（未折扣），買賣各收一次 */
export const BROKERAGE_RATE = 0.001425;

/** 證券交易稅，僅賣出時課徵。稅率不受券商折扣影響。 */
export const TAX_RATE = 0.003;

/**
 * 每筆最低手續費（元）。
 *
 * 折扣後仍受此低消限制 —— 折扣不會讓一筆幾千元的交易只收幾塊錢。
 */
export const MIN_BROKERAGE = 20;

/**
 * 手續費折扣倍率：1 = 無折扣，0.6 = 6 折，0.28 = 2.8 折。
 * 超出範圍或非數值時視為無折扣，寧可高估成本。
 */
function safeDiscount(discount: number | null | undefined): number {
  if (discount == null || !Number.isFinite(discount)) return 1;
  if (discount <= 0 || discount > 1) return 1;
  return discount;
}

function brokerage(value: number, discount?: number | null): number {
  return Math.max(value * BROKERAGE_RATE * safeDiscount(discount), MIN_BROKERAGE);
}

/**
 * 買進 n 股的實際支出（含手續費）。
 *
 * 以股數而非張數為單位，是因為 MIN_BROKERAGE 是**固定成本**：
 * 零股部位金額小的時候它才是主要成本，按張縮放會系統性低估。
 */
export function buyOutlay(price: number, shares: number, discount?: number | null): number {
  const value = price * shares;
  return value + brokerage(value, discount);
}

/** 賣出 n 股的實際入帳（扣手續費與證交稅） */
export function sellProceeds(price: number, shares: number, discount?: number | null): number {
  const value = price * shares;
  return value - brokerage(value, discount) - value * TAX_RATE;
}

/** 在某個出場價，n 股的淨損益（正為獲利、負為虧損） */
export function netPnl(
  entry: number,
  exit: number,
  shares: number,
  discount?: number | null,
): number {
  return sellProceeds(exit, shares, discount) - buyOutlay(entry, shares, discount);
}

/** 買進一張的實際支出（含手續費） */
export function buyOutlayPerLot(price: number, discount?: number | null): number {
  return buyOutlay(price, SHARES_PER_LOT, discount);
}

/** 賣出一張的實際入帳（扣手續費與證交稅） */
export function sellProceedsPerLot(price: number, discount?: number | null): number {
  return sellProceeds(price, SHARES_PER_LOT, discount);
}

/** 在某個出場價的每張淨損益（正為獲利、負為虧損） */
export function netPnlPerLot(entry: number, exit: number, discount?: number | null): number {
  return netPnl(entry, exit, SHARES_PER_LOT, discount);
}

/**
 * 損益兩平價：賣出淨額剛好等於買進支出的價格。
 *
 * 買進後股價必須先漲過這個價位才開始真正賺錢 —— 未考慮費用時容易誤以為
 * 只要高於進場價就是獲利。
 */
export function breakevenPrice(entry: number, discount?: number | null): number {
  const rate = BROKERAGE_RATE * safeDiscount(discount);
  const denominator = 1 - rate - TAX_RATE;
  if (denominator <= 0) return entry;
  // 最低手續費在一般張數金額下不會觸發，此處以費率式求解即可
  return (entry * (1 + rate)) / denominator;
}

/**
 * 把倍率轉成台股習慣的「折」數：0.6 → "6"、0.28 → "2.8"、1 → "10"。
 * 使用者跟券商談的是「折」，畫面就用「折」，不要求他們自己換算成小數。
 */
export function discountToTenths(discount: number): string {
  const tenths = Math.round(safeDiscount(discount) * 1000) / 100;
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}

/** 一趟來回的成本佔交易金額的百分比 */
export function roundTripCostPct(discount?: number | null): number {
  return (BROKERAGE_RATE * safeDiscount(discount) * 2 + TAX_RATE) * 100;
}

/**
 * 特定價格與股數下，來回成本佔部位金額的百分比。
 *
 * 與 roundTripCostPct 的差別只有一個：低消。費率式的 0.585% 在整股金額下
 * 正確，但零股部位小於約 NT$14,035 時 20 元低消會接管，實際佔比可以高到 4.3%
 * （1 股 × NT$1,000）。畫面要印給使用者看的是後者。
 *
 * 以進場價買進、同價賣出計算 —— 這是「光是進出一趟就付掉多少」，
 * 與停利價無關，因此不需要交易計畫的其他數字。
 */
export function roundTripCostPctFor(
  price: number,
  shares: number,
  discount?: number | null,
): number {
  if (!(price > 0) || !(shares > 0)) return 0;
  const value = price * shares;
  return ((brokerage(value, discount) * 2 + value * TAX_RATE) / value) * 100;
}

export type LotEconomics = {
  /** 損益兩平價 */
  breakeven: number;
  /** 損益兩平價相對進場價的漲幅（%） */
  breakevenPct: number;
  /** 每張淨獲利（停利出場） */
  netRewardPerLot: number;
  /** 每張淨虧損（停損出場，正數表示虧損金額） */
  netRiskPerLot: number;
  /** 每張在第一目標的淨獲利；無第一目標時為 null */
  netFirstTargetPerLot: number | null;
};

export function lotEconomics(opts: {
  entry: number;
  stop: number;
  target: number;
  firstTarget?: number | null;
  /** 券商手續費折扣倍率（1 = 無折扣）。未提供時以無折扣計算。 */
  discount?: number | null;
}): LotEconomics | null {
  const { entry, stop, target, firstTarget, discount } = opts;
  if (!(entry > 0) || !(stop > 0) || !(target > 0)) return null;

  const breakeven = breakevenPrice(entry, discount);
  return {
    breakeven,
    breakevenPct: ((breakeven - entry) / entry) * 100,
    netRewardPerLot: netPnlPerLot(entry, target, discount),
    // 停損出場一定是虧損，取絕對值讓呼叫端不必再判斷正負
    netRiskPerLot: Math.abs(netPnlPerLot(entry, stop, discount)),
    netFirstTargetPerLot:
      firstTarget != null && firstTarget > 0 ? netPnlPerLot(entry, firstTarget, discount) : null,
  };
}
