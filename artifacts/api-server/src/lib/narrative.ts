/**
 * 由已算出的欄位組出中文摘要 —— **模板組句，不呼叫任何模型**。
 *
 * 不採用模型生成的理由有三個：`/analyze` 現已耗時 16~20 秒，而 Gemini
 * 免費額度是本專案最主要的限制；要模型寫個股摘要必須在取得個股資料後
 * 再發一輪請求，延遲與額度都要再付一次；最重要的是模型敘述容易與上方
 * 的數字互相矛盾，而這份摘要就印在那些數字旁邊。
 *
 * 因為只使用已算出的欄位，這段文字永遠不會與畫面上的數字牴觸。
 * 任一欄位缺席時該段整句略過，不編造內容 —— 寧可短，不要編。
 *
 * 不涉及 HTTP、不讀環境變數，因此可獨立測試。
 */

import type { AdviceAction, PlanKind } from "@workspace/advice";

import type { ChipTrend } from "./chips";
import type { Signal, Trend } from "./signals";

const TREND_TEXT: Record<Trend, string> = {
  uptrend: "處於上升趨勢",
  downtrend: "處於下降趨勢",
  range: "在區間整理",
};

const ACTION_TEXT: Record<AdviceAction, string> = {
  can_enter: "現價落在建議進場區內",
  wait_pullback: "已離月線過遠，等回檔再進場",
  wait_breakout: "需先站回進場區，計畫才成立",
  stop_breached: "現價已跌破停損，不建議進場",
  insufficient_data: "資料不足，無法給出操作建議",
};

const CHIP_TREND_TEXT: Record<ChipTrend, string> = {
  accumulating: "買盤持續加強",
  slowing: "買盤已在退潮",
  reversing_down: "近期轉為站在賣方",
  distributing: "賣壓持續加強",
  easing: "賣壓已經減輕",
  reversing_up: "近期轉為站在買方",
  neutral: "沒有明顯方向",
  insufficient_data: "資料不足以判斷動向",
};

const STRATEGY_TEXT: Record<string, string> = {
  "1m": "短線（約 1 個月）",
  "3m": "波段（約 3 個月）",
  "6m": "中長線（約 6 個月）",
};

export interface NarrativeInput {
  name: string | null;
  code: string;
  trend: Trend;
  action: AdviceAction;
  planKind: PlanKind;
  signals: Signal[];
  /** 外資近 5 個交易日淨買超（股數） */
  foreignNet5d: number | null;
  foreignTrend: ChipTrend | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  riskRewardRatio: number | null;
  period: string | null;
}

const lots = (shares: number) => Math.abs(Math.round(shares / 1000)).toLocaleString();

/**
 * 摘要句。回傳 null 代表連第一句都組不出來，畫面整塊不顯示。
 */
export function buildNarrative(input: NarrativeInput): string | null {
  const parts: string[] = [];
  const who = input.name ?? input.code;

  parts.push(`${who}目前${TREND_TEXT[input.trend] ?? "趨勢不明"}，${ACTION_TEXT[input.action] ?? "操作建議不明"}。`);

  // 訊號：看多最多 3 條、看空最多 2 條。中性訊號不入句 ——
  // 「爆量」放進看多或看空任一邊都是在陳述一個資料支持不了的方向。
  const bullish = input.signals.filter((s) => s.direction === "bullish").slice(0, 3);
  const bearish = input.signals.filter((s) => s.direction === "bearish").slice(0, 2);
  const clauses: string[] = [];
  if (bullish.length > 0) clauses.push(`看多訊號有${bullish.map((s) => s.label).join("、")}`);
  if (bearish.length > 0) clauses.push(`看空訊號有${bearish.map((s) => s.label).join("、")}`);
  if (clauses.length > 0) parts.push(`${clauses.join("；")}。`);

  if (input.foreignNet5d !== null && input.foreignTrend !== null) {
    const side = input.foreignNet5d >= 0 ? "買超" : "賣超";
    parts.push(
      `籌碼面外資近 5 日${side} ${lots(input.foreignNet5d)} 張，${CHIP_TREND_TEXT[input.foreignTrend] ?? "動向不明"}。`,
    );
  }

  // 計畫價位。planKind 為 none 時整句略過 —— 那組價位的前提已經不存在，
  // 寫進摘要就是把畫面剛剛抑制掉的矛盾用文字重新講一次。
  const { entryLow, entryHigh, stopLoss, riskRewardRatio, planKind } = input;
  if (planKind !== "none" && entryLow !== null && entryHigh !== null && stopLoss !== null) {
    const rr = riskRewardRatio !== null ? `（風報比 ${riskRewardRatio.toFixed(2)}）` : "";
    const strategy = STRATEGY_TEXT[input.period ?? "3m"] ?? STRATEGY_TEXT["3m"]!;
    parts.push(
      planKind === "conditional"
        ? `站回 ${entryLow} 之上這份計畫才成立，屆時進場區 ${entryLow}~${entryHigh}、停損 ${stopLoss}${rr}，適合${strategy}操作。`
        : `建議進場區 ${entryLow}~${entryHigh}，停損 ${stopLoss}${rr}，適合${strategy}操作。`,
    );
  }

  return parts.length > 0 ? parts.join("") : null;
}
