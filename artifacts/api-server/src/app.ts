import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { findWebBuild } from "./lib/webBuild";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
/**
 * CORS 預設關閉，只有明確設定 ALLOWED_ORIGINS 才開放。
 *
 * 正式環境的前端與 API 同源（Netlify 把 /api/* 轉給函式），同源請求根本
 * 不經過 CORS，所以不需要任何標頭。原本的 `cors()` 是全開 —— 那等於允許
 * 任何網站的 JavaScript 拿你的網域去呼叫 /api/analyze，燒的是你的 Gemini 額度。
 *
 * 要注意 CORS 只約束瀏覽器：它擋得住別的網站用 JS 呼叫，擋不住 curl 或
 * 腳本。真正限制濫用量的是 analyze 路由上的每日配額。
 */
const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use(cors({ origin: allowedOrigins }));
  logger.info({ allowedOrigins }, "CORS enabled for explicit origins");
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

/**
 * 未匹配的 API 路徑回 JSON 而非 Express 預設的 HTML 錯誤頁。
 *
 * 前端的 fetch 包裝會嘗試解析 JSON，收到 HTML 時丟出的是解析錯誤，
 * 使用者看到的訊息會與真正的原因（路徑打錯）完全無關。
 */
app.use("/api", (req, res) => {
  res.status(404).json({ error: `找不到 API 路徑：${req.method} /api${req.path}` });
});

// ─── 前端網頁 ──────────────────────────────────────────────────────────────
// API 路由先掛，網頁後掛：/api/* 永遠由上面處理，不會被 SPA 收尾吃掉。
const webBuild = findWebBuild();

if (webBuild) {
  logger.info({ dir: webBuild.dir }, "Serving web build");

  // 資源檔名帶內容雜湊（entry-0f3db….js），可以放心長期快取。
  // index:false 讓 "/" 交給下面的收尾統一處理，避免兩處各送一次。
  app.use(
    express.static(webBuild.dir, {
      index: false,
      maxAge: "1y",
      // 必須允許點開頭的路徑段：Expo 匯出的資源路徑含 pnpm 的實體目錄
      // assets/__node_modules/.pnpm/@expo-google-fonts+inter@…/…ttf
      // 預設的 'ignore' 會讓這些檔案被視為不存在，接著落到下面的 SPA 收尾，
      // 於是字型請求拿到一份 index.html（HTTP 200、content-type: text/html），
      // 畫面因此退回系統襯線字而不會報錯 —— 只在正式建置才會出現。
      // 此目錄全是建置產物，沒有機密，允許點開頭是安全的。
      dotfiles: "allow",
      setHeaders(res, filePath) {
        // index.html 不能快取，否則使用者會一直拿到舊版指向已不存在的 bundle
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  /**
   * SPA 收尾。expo-router 在網頁上用 URL 路由（/analysis?keyword=…），
   * 重新整理或直接貼網址時伺服器上並沒有對應的檔案，必須回 index.html
   * 讓前端自己解析路徑。
   *
   * 刻意排除 /api：未匹配的 API 路徑應該回 404，回一份 HTML 會讓
   * 前端把 JSON 解析失敗誤報成別的錯誤。
   */
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();

    // 帶副檔名的請求是要拿檔案，不是路由。靜態服務沒接到就是真的缺檔，
    // 應該回 404 —— 回 index.html 會讓缺檔變成「200 但內容是 HTML」，
    // 瀏覽器不報錯、只是靜靜地退回預設字型，問題因此完全隱形。
    if (/\.[a-z0-9]+$/i.test(req.path)) {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(webBuild.indexHtml);
  });
} else {
  // 本機用 Metro 跑前端時是正常狀態，不是錯誤 —— 但要說清楚，
  // 否則部署後只看到 API 有反應會以為是路由設錯。
  logger.info("No web build found; serving API only (run the web export to serve the page too)");
}

export default app;
