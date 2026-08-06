import type { OutcomeTally } from '@workspace/api-client-react';

/**
 * 前瞻驗證的統計誠實度。
 *
 * 這是全站唯一宣稱「已驗證」的數字，先前卻是最沒有統計效力的那個：
 * 第一次對答案時 40 筆計畫裡可能 30 筆未進場、9 筆仍持有、1 筆達標，
 * decided = 1、targetRate = 100.0 —— 而首頁用 text-2xl 印出綠色的
 * 「100.0%」，這個數字接著出現在當天查的每一張個股卡片上，
 * 語氣是「這套規則目前實測」。
 *
 * 會自己寫回測的人看到 n=1 的 100% 被當成 validation evidence，
 * 對整份工具的信任會直接歸零；不會回測的人會把它讀成「十次對十次」。
 */

/**
 * 給出百分比所需的最少已結案筆數。
 *
 * **經驗值，未經驗證** —— 與這個專案其他經驗參數同樣的性質，畫面上必須標明。
 * 20 筆時 Wilson 區間仍有 ±20 個百分點，但至少寬度說得出「這還很粗」；
 * 低於 20 筆連區間都寬到沒有資訊量。
 */
export const MIN_DECIDED = 20;

/** 已結案筆數夠不夠支撐一個百分比 */
export function isConclusive(decided: number): boolean {
  return decided >= MIN_DECIDED;
}

/**
 * Wilson 95% 信賴區間（百分比）。
 *
 * 小樣本下比常態近似誠實得多：1 戰 1 勝的常態近似會給出 [100%, 100%]，
 * Wilson 給的是 [20.7%, 100%] —— 後者才講得出「這個數字沒有結論」。
 */
export function wilson95(successes: number, total: number): [number, number] | null {
  if (!(total > 0)) return null;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return [Math.max(0, (center - margin) * 100), Math.min(100, (center + margin) * 100)];
}

/**
 * 合併多批驗證結果。
 *
 * 後端一次最多收 40 筆（outcome.ts 的 MAX_ITEMS），而累積三個月的使用者
 * 可能有 200 筆計畫 —— 先前超過的部分被靜默截斷，畫面上五格加總永遠是 40，
 * 而且保留的是**最新**（最沒走完）的那批，於是 open 與 noEntry 被系統性
 * 放大、decided 被系統性壓縮。累積越久的人看到的 decided 反而不會增加。
 *
 * 比率一律由合併後的分子分母重算 —— 把兩批的百分比平均是錯的：
 * 1 勝 0 敗（100%）與 0 勝 9 敗（0%）合併起來是 10%，不是 50%。
 */
export function mergeTallies(tallies: ReadonlyArray<OutcomeTally>): OutcomeTally {
  const sum = (pick: (t: OutcomeTally) => number | undefined) =>
    tallies.reduce((acc, t) => acc + (pick(t) ?? 0), 0);

  const target = sum((t) => t.target);
  const stop = sum((t) => t.stop);
  const ambiguous = sum((t) => t.ambiguous);
  const open = sum((t) => t.open);
  const noEntry = sum((t) => t.noEntry);
  const unknown = sum((t) => t.unknown);
  const decided = sum((t) => t.decided);
  const entered = sum((t) => t.entered);

  // 成立率的分母是所有可判定的計畫，不含資料不足的那些
  const evaluated = target + stop + ambiguous + open + noEntry;

  return {
    target,
    stop,
    ambiguous,
    open,
    noEntry,
    unknown,
    decided,
    entered,
    targetRate: decided > 0 ? (target / decided) * 100 : null,
    entryRate: evaluated > 0 ? (entered / evaluated) * 100 : null,
  };
}
