import pino from "pino";

/**
 * 條件刻意是「等於 development」而不是「不等於 production」。
 *
 * pino-pretty 是透過 worker thread 執行的 transport，在 serverless 上會因為
 * 找不到 worker 檔而爆掉。而函式執行環境的 NODE_ENV 不保證是 "production" ——
 * 用反向條件的話，只要它是空的就會意外走進 pretty 分支。
 * 預設輸出純 JSON 到 stdout 是最安全的：任何平台都收得到。
 */
const usePrettyLogs = process.env.NODE_ENV === "development";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(usePrettyLogs
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
