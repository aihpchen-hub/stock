/**
 * 畫面上所有數字的統一格式。
 *
 * 先前同一件事在四個檔案各寫一份，於是同一張卡片上會出現：
 * 半形 '-' 與全形 '—' 兩種缺值符號、法人買賣超有無千分位兩種樣子、
 * 「-0張」（Math.round(-0.4) 是負零）、「-0.0%」配紅色下跌箭頭（其實是打平）、
 * 以及中小型股一律塌成「0.0 億」的自由現金流。
 *
 * 這些都不是各自的 bug，是同一個決定被複製四次之後各自漂移。
 */

/** 沒有資料。全站只有這一種寫法 */
export const EMPTY = '—';

/** 台股一張 = 1000 股 */
const SHARES_PER_LOT = 1000;

function isUsable(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** 消掉負零：Math.round(-0.4) 是 -0，樣板字串會印成「-0」 */
function noNegativeZero(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * 法人買賣超（股 → 張）。
 *
 * 零是有效資料 —— 那代表法人今天沒有動作，不是「我們沒抓到」。
 * 先前寫成 `if (!qty) return '-'`，兩者顯示成同一個東西。
 */
export function formatLots(shares: number | null | undefined): string {
  if (!isUsable(shares)) return EMPTY;
  const lots = noNegativeZero(Math.round(shares / SHARES_PER_LOT));
  return `${lots > 0 ? '+' : ''}${lots.toLocaleString('en-US')}張`;
}

/**
 * 成交量（股 → 張）。
 *
 * 與買賣超不同，這裡的零沒有意義：一檔完全沒有成交的股票，
 * 「0 張」與「沒有資料」對使用者是同一件事（都不能下單）。
 */
export function formatVolumeLots(shares: number | null | undefined): string {
  if (!isUsable(shares) || shares <= 0) return EMPTY;
  return `${Math.round(shares / SHARES_PER_LOT).toLocaleString('en-US')}張`;
}

/**
 * 帶正負號的百分比。
 *
 * 四捨五入後為零時不帶號 —— 先前 (-0.04).toFixed(1) 得到 '-0.0'，
 * 畫面印出「-0.0%」還配上紅色下跌箭頭，而那其實是打平。
 */
export function formatSignedPct(value: number | null | undefined, digits = 1): string {
  if (!isUsable(value)) return EMPTY;
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toFixed(digits)}%`;
}

/**
 * 新台幣金額。
 *
 * `compact` 依量級選單位而非固定除以一億 —— 後者讓所有中小型股的
 * 自由現金流都塌成「0.0 億」「-0.0 億」，那個欄位因此完全沒有資訊量。
 */
export function formatNTD(
  value: number | null | undefined,
  opts: { compact?: boolean } = {},
): string {
  if (!isUsable(value)) return EMPTY;
  const rounded = noNegativeZero(Math.round(value));

  if (!opts.compact) return rounded.toLocaleString('en-US');

  const abs = Math.abs(rounded);
  if (abs >= 100_000_000) {
    return `${noNegativeZero(Number((rounded / 100_000_000).toFixed(2)))}億`;
  }
  if (abs >= 10_000) {
    return `${noNegativeZero(Math.round(rounded / 10_000)).toLocaleString('en-US')}萬`;
  }
  return rounded.toLocaleString('en-US');
}
