/**
 * 數字輸入欄的編輯規則 —— 抽成純函式，因為本專案的 vitest 環境是 node，
 * 沒有 React 元件測試環境，元件本身測不到。判斷放這裡才有測試涵蓋，
 * 元件只剩下「畫出來」這件事。
 */

/** 編輯途中允許的字串：空字串、單獨一個負號、以及帶最多一個小數點的數字 */
const DRAFT_PATTERN = /^-?\d*\.?\d*$/;

/**
 * 這個字串能不能留在輸入框裡（而不是「是不是一個合法的值」）。
 *
 * 空字串必須放行，否則使用者永遠刪不掉最後一位數字 ——
 * 先前每按一次鍵就把值寫進 localStorage 再讀回來，而儲存函式對
 * 非正數是靜默拒絕，於是退格的瞬間舊值就被寫回輸入框。
 * 手機上因此只能雙擊全選再重打。
 */
export function isEditableDraft(draft: string): boolean {
  return DRAFT_PATTERN.test(draft);
}

export interface CommitOptions {
  min?: number;
  max?: number;
  /** 提交時取整（金額用），小數欄位不設 */
  integer?: boolean;
}

/**
 * 離開欄位時把草稿字串收斂成一個實際的值。
 *
 * 空白或解析不出數字 → 退回上一個值。使用者清空欄位再走開，
 * 多半是改變主意或編到一半，退回原值最不意外；把空欄位夾成
 * 下限（例如 1 元）反而是憑空生出一個他沒說過的數字。
 *
 * 解析得出但超出範圍 → 夾到邊界。那是他確實表達過的意圖，只是超界。
 */
export function commitNumber(draft: string, previous: number, opts: CommitOptions = {}): number {
  const trimmed = draft.trim();
  if (trimmed === "") return previous;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return previous;

  let value = parsed;
  if (opts.min !== undefined && value < opts.min) value = opts.min;
  if (opts.max !== undefined && value > opts.max) value = opts.max;
  if (opts.integer) value = Math.round(value);

  return value;
}

/**
 * 把已提交的值轉回顯示字串。
 *
 * 用 `String(n)` 而非固定小數位：0.6 倍率顯示成「6」折而不是「6.0」折，
 * 而 2.8 折仍然是「2.8」。固定位數會讓整數欄位多出沒有意義的尾巴。
 */
export function toDraft(value: number): string {
  if (!Number.isFinite(value)) return "";
  // 浮點乘法會produce 30.000000000000004 這種值（0.3 × 100），
  // 顯示前先收掉尾差 —— 它來自儲存格式（比例存小數）而非使用者輸入。
  return String(Math.round(value * 1e6) / 1e6);
}
