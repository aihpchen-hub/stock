import { Router, type IRouter } from "express";

const router: IRouter = Router();

/**
 * 回應形狀由 lib/api-spec/openapi.yaml 的 healthCheck 定義。
 *
 * 這裡刻意不引用 @workspace/api-zod 做執行期驗證 —— 那會把 zod 拖進
 * Netlify 函式的依賴圖，而它在那裡解析不到：
 *
 * esbuild 會把 workspace 套件的 TypeScript 原始碼**內聯**進函式 bundle，
 * 但 zod 仍是外部 import。於是 bundle 自己 `import "zod"`，解析從 bundle
 * 所在目錄往上找 node_modules —— 而打包器只在 lib/api-zod/node_modules/
 * 底下建了 zod 的連結（它是從那個 workspace 套件的角度追蹤到的），
 * artifacts/api-server/node_modules/ 底下沒有。結果是函式冷啟動即
 * ERR_MODULE_NOT_FOUND，而建置階段完全不會報錯。
 *
 * 用一行 schema 去驗證一個寫死的字面值，換不到這個代價。
 * 若日後要在函式裡做真正的執行期驗證，得先解決上述解析問題。
 */
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
