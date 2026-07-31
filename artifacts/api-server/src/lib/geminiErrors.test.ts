import { describe, expect, it } from "vitest";

import { describeGeminiFailure } from "./geminiErrors";

const ctx = { keyCount: 2, modelCount: 2 };

describe("describeGeminiFailure", () => {
  it("網路失敗要明說不是額度問題", () => {
    // SDK 連不上時的真實訊息（本機實測）
    const err = new Error(
      "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent: fetch failed",
    );
    const msg = describeGeminiFailure(err, ctx);
    expect(msg).toContain("連不上");
    expect(msg).toContain("不是額度用完");
  });

  it("網路錯誤不會被誤判為模型不存在", () => {
    // 訊息裡含有模型名稱，不能因此比中 404 分支
    const err = new Error("Error fetching from .../models/gemini-3.5-flash: fetch failed");
    expect(describeGeminiFailure(err, ctx)).not.toContain("模型名稱");
  });

  it("各種連線錯誤碼都歸為網路問題", () => {
    for (const code of ["ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"]) {
      expect(describeGeminiFailure(new Error(`request to ... failed, reason: ${code}`), ctx)).toContain(
        "連不上",
      );
    }
  });

  it("逾時中止歸為網路問題", () => {
    expect(describeGeminiFailure(new Error("The operation was aborted"), ctx)).toContain("連不上");
  });

  it("額度用盡要說明已試過幾種組合", () => {
    const msg = describeGeminiFailure(new Error("[429 Too Many Requests] quota exceeded"), ctx);
    expect(msg).toContain("額度已用完");
    expect(msg).toContain("2 把金鑰");
    expect(msg).toContain("2 個模型");
  });

  it("RESOURCE_EXHAUSTED 也視為額度問題", () => {
    expect(describeGeminiFailure(new Error("RESOURCE_EXHAUSTED"), ctx)).toContain("額度已用完");
  });

  it("金鑰無效指向金鑰設定", () => {
    expect(describeGeminiFailure(new Error("[401 Unauthorized] API key not valid"), ctx)).toContain(
      "金鑰無效",
    );
  });

  it("模型不存在指向模型名稱", () => {
    expect(
      describeGeminiFailure(new Error("[404 Not Found] models/gemini-2.5-flash is not found"), ctx),
    ).toContain("模型名稱");
  });

  it("服務過載與額度用盡分開陳述", () => {
    const msg = describeGeminiFailure(new Error("[503 Service Unavailable] model is overloaded"), ctx);
    expect(msg).toContain("過載");
    expect(msg).not.toContain("額度");
  });

  it("回傳非 JSON 時指向格式問題", () => {
    expect(describeGeminiFailure(new SyntaxError("Unexpected token < in JSON"), ctx)).toContain(
      "不是合法 JSON",
    );
  });

  it("無法辨識的錯誤退回通用訊息，不亂猜原因", () => {
    const msg = describeGeminiFailure(new Error("something entirely new"), ctx);
    expect(msg).toBe("分析失敗，請稍後再試。");
  });

  it("非 Error 物件也不會崩潰", () => {
    expect(describeGeminiFailure("plain string", ctx)).toBe("分析失敗，請稍後再試。");
    expect(describeGeminiFailure(null, ctx)).toBe("分析失敗，請稍後再試。");
  });
});
