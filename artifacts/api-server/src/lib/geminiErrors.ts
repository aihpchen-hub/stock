/**
 * 把 Gemini 的失敗轉成使用者看得懂、而且**指向真正原因**的訊息。
 *
 * 為什麼獨立成模組：一句籠統的「請檢查 API 金鑰」曾讓使用者花時間去翻設定，
 * 真正的原因卻是當日額度用盡。錯誤訊息會誤導人，就跟數字算錯一樣嚴重，
 * 所以它值得有自己的測試。
 */

export interface GeminiFailureContext {
  /** 已嘗試的金鑰數，用於說明「不是漏設金鑰」 */
  keyCount: number;
  /** 已嘗試的模型數 */
  modelCount: number;
}

export function describeGeminiFailure(err: unknown, ctx: GeminiFailureContext): string {
  const raw = err instanceof Error ? err.message : String(err);

  // 網路層先判斷：連不上時 SDK 只會說 fetch failed，既不是額度也不是金鑰問題。
  // 四種金鑰×模型組合在幾毫秒內全數失敗，通常就是這一類。
  if (
    /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|AbortError|The operation was aborted/i.test(
      raw,
    )
  ) {
    return "連不上 Gemini 服務（網路或 DNS 問題），這不是額度用完。請確認網路後重試。";
  }

  if (/\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(raw)) {
    return `Gemini 免費額度已用完 —— 已嘗試過 ${ctx.keyCount} 把金鑰 × ${ctx.modelCount} 個模型的所有組合皆受限，請稍後再試或增設備援金鑰（GEMINI_API_KEY_2）。`;
  }

  if (/\b401\b|\b403\b|API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw)) {
    return "Gemini API 金鑰無效或權限不足，請檢查 GEMINI_API_KEY 設定。";
  }

  if (/\b404\b|NOT_FOUND/i.test(raw)) {
    return "找不到指定的 Gemini 模型，請確認模型名稱是否正確。";
  }

  if (/\b503\b|UNAVAILABLE|overloaded/i.test(raw)) {
    return "Gemini 服務暫時過載，請稍後再試。";
  }

  if (err instanceof SyntaxError) {
    return "Gemini 回傳的內容不是合法 JSON，請重新分析。";
  }

  return "分析失敗，請稍後再試。";
}
