import { lotEconomics, type LotEconomics } from './fees';
import { planPosition, type PositionPlan, type RiskSettings } from './settings';

export type PositionInput = {
  /** 進場區上緣。部位與損益一律以它為基準（保守估計） */
  entryHigh?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  firstTarget?: number | null;
  /** 後端算的毛值風險（元／張）。只在算不出淨值時作為退路 */
  riskPerLot?: number | null;
  settings: RiskSettings;
};

export type PositionView = {
  position: PositionPlan | null;
  economics: LotEconomics | null;
  /** 扣費後的實際賠率。停損距離為 0 時為 null，不輸出 Infinity */
  netRiskReward: number | null;
};

export function planPositionFor(input: PositionInput): PositionView {
  const { entryHigh, stopLoss, takeProfit, firstTarget, riskPerLot, settings } = input;

  const economics =
    entryHigh && stopLoss && takeProfit
      ? lotEconomics({
          entry: entryHigh,
          stop: stopLoss,
          target: takeProfit,
          firstTarget,
          discount: settings.feeDiscount,
        })
      : null;

  const position = planPosition({
    riskBudget: settings.riskBudget,
    capital: settings.capital,
    // 使用者設定的是「這一筆最多賠多少錢」，那是實際到手的虧損，不是價差。
    // 後端的 riskPerLot 少算了兩件事：兩趟手續費加一趟證交稅，以及
    // 它以進場區「中值」為基準而部位成本用的是「上緣」—— 整整半個區間寬度。
    // 兩者相加會讓實際最壞虧損系統性超出上限（實測 22,000 的上限跑出 26,257）。
    // 算不出淨值時退回毛值，至少不會少一個保護。
    riskPerLot: economics?.netRiskPerLot ?? riskPerLot,
    entryPrice: entryHigh,
    maxPositionPct: settings.maxPositionPct,
  });

  const netRiskReward =
    economics && economics.netRiskPerLot > 0
      ? economics.netRewardPerLot / economics.netRiskPerLot
      : null;

  return { position, economics, netRiskReward };
}
