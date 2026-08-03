/**
 * 操作建議狀態機 —— 由交易計畫的價位幾何推出「現在到底能不能買」。
 *
 * 這一層存在的理由：`entryLow`/`entryHigh` 在跌破雙均線時代表的是
 * 「**假如**站回月線之後」的進場區，而不是「現在的建議買價」。
 * 畫面若直接把它當成建議買價印出，就會同時出現「建議買價高於現價」
 * 與「現價低於停損」兩個互相矛盾的數字 —— 那不是算錯，是同一組欄位
 * 被賦予了兩種語意。把狀態獨立算出來，畫面才有辦法用正確的說法陳述它們。
 *
 * 只回傳列舉值，不回傳畫面文字 —— 與 `evSignal` 的做法一致，
 * 文案留在前端（見 `artifacts/web/src/components/stock/advice-banner.tsx`）。
 *
 * 為什麼放在 lib/ 而不是後端裡：前端也要用同一份判斷。
 * localStorage 裡在本次部署之前存下的查詢紀錄沒有 `advice` 欄位，
 * 前端得用快照當時存下的價位自行重算 —— 本函式是純函式，
 * 同一組價位算出來的就是當時該顯示的狀態。若讓兩邊各寫一份，
 * 這個「同一組價位、兩種結論」的分歧正是這次要修掉的缺陷本身。
 * 本模組刻意零依賴，後端 esbuild 打包與前端 Vite 建置都能直接內聯。
 */

export type AdviceAction =
  | "can_enter"
  | "wait_pullback"
  | "wait_breakout"
  | "stop_breached"
  | "insufficient_data";

/** 進場區間相對於現價的位置 —— 決定畫面要怎麼稱呼那組價位 */
export type PlanKind =
  /** 區間含現價，可直接掛單 */
  | "immediate"
  /** 區間在現價之下，等回檔 */
  | "pullback"
  /** 區間在現價之上，計畫尚未成立 */
  | "conditional"
  /** 不該顯示任何價位 */
  | "none";

export interface AdviceInput {
  currentPrice: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
}

export interface AdviceOutput {
  action: AdviceAction;
  planKind: PlanKind;
}

export function deriveAdvice(input: AdviceInput): AdviceOutput {
  const { currentPrice, entryLow, entryHigh, stopLoss } = input;

  if (currentPrice === null || entryLow === null || entryHigh === null || stopLoss === null) {
    return { action: "insufficient_data", planKind: "none" };
  }

  // 停損檢查必須排在最前面 —— 而且要排在「區間在現價之上」之前，這與直覺相反。
  //
  // 兩個矛盾價位只在跌破雙均線的分支同時出現。若先攔截那個分支，
  // 這個狀態就永遠不可達，等於把真正要處理的案例吞掉。
  //
  // 在站上均線的分支這裡本來就不可能成立：`entryHigh <= currentPrice`，
  // 故 `entryMid <= currentPrice`，而 `stopLoss = entryMid − 2×ATR×係數 < entryMid`。
  if (currentPrice <= stopLoss) {
    return { action: "stop_breached", planKind: "none" };
  }

  // 區間在現價之上：計畫尚未成立，等突破。
  // 走到這裡必有 stopLoss < currentPrice < entryLow，三者順序一致，沒有矛盾。
  if (entryLow > currentPrice) {
    return { action: "wait_breakout", planKind: "conditional" };
  }

  // 區間在現價之下：追高了，等回檔
  if (entryHigh < currentPrice) {
    return { action: "wait_pullback", planKind: "pullback" };
  }

  return { action: "can_enter", planKind: "immediate" };
}
