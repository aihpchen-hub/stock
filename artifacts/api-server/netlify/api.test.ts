/**
 * 涵蓋 Netlify 函式的包裝層。
 *
 * 為什麼值得單獨測：本機開發直接跑 Express（見 README 的兩終端機流程），
 * 這層 serverless-http + withLambda 的包裝**在本機從來不會被執行**。
 * 少了這個測試，包裝層的錯誤只會在部署後才出現 —— 而那正是最難查的時候，
 * 因為本機怎麼跑都是對的。
 *
 * 這裡只驗包裝層自己的責任（能不能啟動、路徑對不對），
 * 業務邏輯已經由 src/ 底下各自的測試涵蓋。
 *
 * 為什麼這支檔案**不能**放在 functions/ 裡：Netlify 會把該目錄下的每一個
 * 檔案都當成一支函式部署，而函式名稱只允許英數字、連字號與底線 ——
 * `api.test` 裡的點不合法，整個建置會直接失敗。
 * （本機的 `netlify build` 不會重現這個錯誤，只有正式建置才會。）
 */
import { describe, expect, it } from "vitest";

import handler from "./functions/api.mts";

/** Netlify v2 函式收到的第二個參數；這幾個測試用不到裡面的欄位 */
const context = {} as never;

async function call(path: string): Promise<Response> {
  return handler(new Request(`https://example.test${path}`), context);
}

describe("Netlify 函式包裝層", () => {
  it("能啟動並回應健康檢查", async () => {
    const res = await call("/api/healthz");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });

  it("剝掉 /.netlify/functions/api 前綴後仍能對到路由", async () => {
    // Netlify 把 /api/* 轉給函式時可能保留這段前綴。沒剝掉的話 Express
    // 內部掛的 /api 就對不上，會得到一個看起來像路由寫錯的 404。
    const res = await call("/.netlify/functions/api/healthz");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });

  it("未匹配的 API 路徑回 JSON 404 而非 HTML", async () => {
    // 前端的 fetch 包裝會嘗試解析 JSON；收到 HTML 時丟出的是解析錯誤，
    // 使用者看到的訊息會與真正的原因（路徑打錯）完全無關。
    const res = await call("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    await expect(res.json()).resolves.toHaveProperty("error");
  });

  it("缺少必要欄位時回 400 而不是崩潰", async () => {
    const res = await handler(
      new Request("https://example.test/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      context,
    );
    expect(res.status).toBe(400);
  });
});
