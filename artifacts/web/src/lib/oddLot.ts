/**
 * 買不到 1 張時的零股部位。
 *
 * 只在整張路徑算出 0 張時才有意義：算得出整張就給整張，
 * 否則同一張卡片會同時出現兩個「建議買多少」。互斥性由 position.ts 保證。
 *
 * 成本一律以真實股數計算，不用「每張 ÷ 1000」縮放 —— MIN_BROKERAGE 是固定成本，
 * 縮放在低金額會低估到 29%，而低估成本正是這個模組群到處在防的事。
 */

import { netPnl, roundTripCostPctFor } from './fees';
import { clampPositionPct } from './settings';

export type OddLotPlan = {
  shares: number;
  /** 是哪一個上限決定了股數，讓畫面能說明為何買不了更多 */
  limitedBy: 'risk' | 'capital';
  /** 買進金額，不含手續費 —— 與 planPosition 的 cost 同一個定義 */
  cost: number;
  /** 停損出場的實際虧損（含兩趟手續費與一趟證交稅），正數 */
  risk: number;
  pctOfCapital: number;
  capitalCap: number;
  /** 來回成本佔部位金額的百分比 */
  costPct: number;
};

export function planOddLot(opts: {
  riskBudget: number;
  capital: number;
  entryPrice: number | null | undefined;
  stopLoss: number | null | undefined;
  /** 單檔上限（小數）。未提供或超出範圍時採預設值。 */
  maxPositionPct?: number;
  feeDiscount?: number | null;
}): OddLotPlan | null {
  const { riskBudget, capital, entryPrice, stopLoss, feeDiscount } = opts;

  if (!entryPrice || entryPrice <= 0) return null;
  if (!stopLoss || stopLoss <= 0) return null;
  // 停損不低於進場價時 netPnl 算出來是獲利，取絕對值後單調性仍成立，
  // 於是二分搜尋會回傳一個看起來完全正常的假股數。這種計畫本來就不該給部位建議。
  if (stopLoss >= entryPrice) return null;
  if (!Number.isFinite(riskBudget) || riskBudget <= 0) return null;
  if (!Number.isFinite(capital) || capital <= 0) return null;

  const pct = clampPositionPct(opts.maxPositionPct);
  const capitalCap = capital * pct;
  // 與 planPosition 的 byCapital 一致：不含買進手續費
  const byCapital = Math.floor(capitalCap / entryPrice);
  if (byCapital < 1) return null;

  const lossAt = (shares: number) => Math.abs(netPnl(entryPrice, stopLoss, shares, feeDiscount));

  if (lossAt(1) > riskBudget) return null;

  // 風險上限這一條不能直接除：MIN_BROKERAGE 讓成本變成分段函數，
  // 閉式解要分買賣兩邊各兩種、共四個象限，而分支寫錯的方向恰好是低估。
  // 最壞虧損對股數單調遞增（多買一股，虧損必不減少），二分搜尋精確且顯然正確。
  let lo = 1;
  let hi = byCapital;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lossAt(mid) <= riskBudget) lo = mid;
    else hi = mid - 1;
  }

  const shares = lo;
  const cost = shares * entryPrice;

  return {
    shares,
    // 買到資金上限就是資金綁住的；沒買到，代表是風險先攔下來的。
    limitedBy: shares < byCapital ? 'risk' : 'capital',
    cost,
    risk: lossAt(shares),
    pctOfCapital: (cost / capital) * 100,
    capitalCap,
    costPct: roundTripCostPctFor(entryPrice, shares, feeDiscount),
  };
}
