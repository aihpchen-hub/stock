/**
 * 台股股票的最小升降單位（檔位）。
 *
 * 這不是顯示美化，是可執行性問題：先前算出的停損 2040.43 元，對股價 1000 元以上
 * 的股票根本無法下單（該價格區間的檔位是 5 元）。畫面上寫著一個下不出去的價格，
 * 比寫一個略有誤差的價格更糟 —— 使用者照著填會被退單。
 *
 * 級距依證交所規定（上市／上櫃普通股）。
 */

interface TickBand {
  /** 小於此價格時適用（最後一段為 Infinity） */
  below: number;
  tick: number;
}

const TICK_BANDS: TickBand[] = [
  { below: 10, tick: 0.01 },
  { below: 50, tick: 0.05 },
  { below: 100, tick: 0.1 },
  { below: 500, tick: 0.5 },
  { below: 1000, tick: 1 },
  { below: Infinity, tick: 5 },
];

/** 某個價格所在區間的最小升降單位 */
export function tickSize(price: number): number {
  const band = TICK_BANDS.find((b) => price < b.below);
  return band?.tick ?? 5;
}

/**
 * 取整到最近的合法檔位。
 *
 * 跨區間時仍然安全：49.98 → 50.00、999.6 → 1000，兩者在新區間的檔位下
 * 都是合法價格（50 可被 1 整除、1000 可被 5 整除）。
 */
export function roundToTick(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const tick = tickSize(price);
  // 先乘後除避免浮點誤差累積（0.1 與 0.05 都不是二進位可精確表示的數）
  const rounded = Math.round(price / tick) * tick;
  return Math.round(rounded * 100) / 100;
}
