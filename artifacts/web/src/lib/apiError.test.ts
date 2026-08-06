import { describe, expect, it } from 'vitest';

import { apiErrorMessage } from './apiError';

/** 模擬 custom-fetch 丟出來的 ApiError：data 是解析後的回應主體 */
function apiError(status: number, data: unknown) {
  return Object.assign(new Error(`HTTP ${status}`), { name: 'ApiError', status, data });
}

describe('apiErrorMessage', () => {
  it('優先採用後端寫好的原因', () => {
    // geminiErrors.ts 已經把「配額用盡」「金鑰無效」「模型不可用」分好類，
    // 而畫面先前一律彈 alert('分析失敗')，那些字全部被丟掉。
    const err = apiError(500, { error: '今日 Gemini 分析額度已用盡，請明天再試。' });
    expect(apiErrorMessage(err)).toBe('今日 Gemini 分析額度已用盡，請明天再試。');
  });

  it('後端沒給原因時依狀態碼給看得懂的說法', () => {
    expect(apiErrorMessage(apiError(429, {}))).toContain('太頻繁');
    expect(apiErrorMessage(apiError(504, {}))).toContain('太久');
    expect(apiErrorMessage(apiError(503, {}))).toContain('暫時');
  });

  it('伺服器錯誤有預設說法，不會把 HTTP 500 直接丟給使用者', () => {
    const msg = apiErrorMessage(apiError(500, {}));
    expect(msg).not.toContain('HTTP');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('斷網等非 HTTP 錯誤講的是連線問題', () => {
    expect(apiErrorMessage(new TypeError('Failed to fetch'))).toContain('連線');
  });

  it('完全認不得的東西也給得出一句話，不會回 undefined', () => {
    for (const junk of [null, undefined, 42, {}, 'boom']) {
      expect(typeof apiErrorMessage(junk)).toBe('string');
      expect(apiErrorMessage(junk).length).toBeGreaterThan(0);
    }
  });

  it('不把後端的空字串當成有效原因', () => {
    const msg = apiErrorMessage(apiError(500, { error: '   ' }));
    expect(msg.trim().length).toBeGreaterThan(0);
    expect(msg).not.toBe('   ');
  });
});
