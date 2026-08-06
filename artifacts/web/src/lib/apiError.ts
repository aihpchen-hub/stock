/**
 * 把 API 錯誤翻成使用者看得懂的一句話。
 *
 * 後端其實很努力：`geminiErrors.ts` 把「配額用盡」「金鑰無效」「模型不可用」
 * 分好類並寫成中文，`analyze.ts` 也把它放進回應的 `error` 欄位。
 * 但畫面先前一律 `alert('分析失敗')` —— 使用者等了 16~20 秒，換來一個
 * 沒有任何原因的系統對話框，然後被踢回首頁，連輸入的關鍵字都沒了。
 * 「今日分析額度已用盡，明天再試」和「分析失敗」對使用者是兩件完全不同的事。
 */

function readString(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** 後端沒給原因時，至少依狀態碼講一句有行動意義的話 */
function byStatus(status: number): string {
  if (status === 429) return '請求太頻繁，請稍候一分鐘再試。';
  if (status === 504 || status === 408) return '這次分析花的時間太久而中斷了，請再試一次。';
  if (status === 503) return '服務暫時無法回應，請稍後再試。';
  if (status >= 500) return '伺服器處理這次請求時出錯了，請再試一次。';
  if (status === 404) return '找不到這個標的的資料。';
  if (status >= 400) return '這次請求的內容有問題，請調整後再試。';
  return '請求失敗，請再試一次。';
}

export function apiErrorMessage(err: unknown): string {
  const status = typeof (err as { status?: unknown })?.status === 'number'
    ? (err as { status: number }).status
    : null;

  if (status !== null) {
    // 後端寫好的原因優先 —— 那是唯一知道「為什麼」的一層
    const data = (err as { data?: unknown }).data;
    return readString(data, 'error') ?? readString(data, 'message') ?? byStatus(status);
  }

  // fetch 本身失敗：斷網、DNS、CORS。這時沒有 HTTP 狀態可言。
  if (err instanceof Error) return '連線失敗，請確認網路後再試一次。';

  return '發生未預期的錯誤，請再試一次。';
}
