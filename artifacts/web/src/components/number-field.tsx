import React from 'react';
import { commitNumber, isEditableDraft, toDraft, type CommitOptions } from '@/lib/numberField';

interface NumberFieldProps extends CommitOptions {
  label: string;
  /** 已提交的值（顯示單位，例如 30 代表 30%） */
  value: number;
  /** 離開欄位時才呼叫，不是每按一次鍵 */
  onCommit: (value: number) => void;
  /** 範圍說明，例如「1~100」 */
  hint?: string;
  /**
   * 這個欄位是什麼意思。
   *
   * settings.ts 的註解裡本來就寫好了白話說明（「帳戶裡現在能買股票的現金，
   * 不是總資產」），但只有讀原始碼的人看得到 —— 畫面上四個標題並排，
   * 新手分不出「單筆最大虧損」與「單檔上限」的差別，而這兩個值直接決定
   * 卡片上印出來的建議張數。
   */
  description?: string;
}

/**
 * 數字輸入欄。
 *
 * 編輯期間由本元件自己保管字串草稿，離開欄位（或按 Enter）才提交 ——
 * 先前是每按一次鍵就寫進 localStorage 再讀回來，而儲存函式對非正數
 * 靜默拒絕，於是退格到剩一位數時舊值立刻被寫回，最後一位在數學上
 * 刪不掉。手機沒有方向鍵可以繞過，只能雙擊全選重打。
 *
 * 用 type="text" + inputMode 而非 type="number"：
 * - type="number" 在內容不合法時（例如剛打完「1.」）回傳空字串，
 *   草稿會被吃掉，正是要避免的那件事
 * - 手機鍵盤由 inputMode 決定，不需要靠 type="number" 取得數字鍵盤
 * - 順便去掉桌機上那對容易誤觸的上下箭頭
 */
export function NumberField({
  label,
  value,
  onCommit,
  hint,
  description,
  min,
  max,
  integer,
}: NumberFieldProps) {
  const [draft, setDraft] = React.useState(() => toDraft(value));
  const [editing, setEditing] = React.useState(false);
  // 標籤與輸入框先前沒有關聯 —— 螢幕閱讀器唸不出這個欄位叫什麼，
  // 點標籤也不會聚焦到欄位（那是所有人都預期得到的行為，不只無障礙）。
  const id = React.useId();
  const describedBy = description ? `${id}-desc` : undefined;

  // 外部值變動時同步回草稿，但編輯中不覆蓋 —— 否則使用者打到一半
  // 會被另一個來源的更新洗掉。
  React.useEffect(() => {
    if (!editing) setDraft(toDraft(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = commitNumber(draft, value, { min, max, integer });
    setDraft(toDraft(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm text-muted-foreground block">
        {label}
        {hint && <span className="ml-1 text-xs opacity-70">({hint})</span>}
      </label>
      {description && (
        <p id={describedBy} className="text-xs text-muted-foreground/90 leading-relaxed">
          {description}
        </p>
      )}
      <input
        id={id}
        aria-describedby={describedBy}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        // 讓 iOS 顯示數字鍵盤而非全鍵盤
        pattern={integer ? '[0-9]*' : '[0-9.]*'}
        autoComplete="off"
        className="w-full bg-background border border-input rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-1 focus:ring-primary"
        value={draft}
        onFocus={(e) => {
          setEditing(true);
          // 手機上點進來就全選，想整個換掉的人不必先清空；
          // 想改單一位數的人點一下游標即可，兩種需求都不擋。
          e.currentTarget.select();
        }}
        onChange={(e) => {
          const next = e.target.value;
          if (isEditableDraft(next)) setDraft(next);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </div>
  );
}
