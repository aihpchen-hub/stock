import { describe, expect, it } from "vitest";

import { extractPublishedAt } from "./articleDate";

describe("從文章頁抽出發布時間", () => {
  // 以下四種標記都在三家主力來源上實測過（2026-08-05）：
  // 鉅亨網給 article:published_time 與 ld+json，工商時報四種都給，
  // 經濟日報只給 ld+json。Tavily 的一般搜尋完全不回傳發布時間，
  // 而 topic="news" 會回一整頁美股英文新聞，兩條路都走不通，只能從頁面讀。
  it("讀 article:published_time（鉅亨網、工商時報）", () => {
    const html = `<meta property="article:published_time" content="2026-01-09T08:15:44.000Z">`;
    expect(extractPublishedAt(html)).toBe("2026-01-09");
  });

  it("讀 ld+json 的 datePublished（經濟日報唯一給的標記）", () => {
    const html = `<script type="application/ld+json">{"datePublished":"2026-06-17T21:58:01+08:00"}</script>`;
    expect(extractPublishedAt(html)).toBe("2026-06-17");
  });

  it("接受不帶 T 的格式 —— 工商時報給的是 2026-07-09 18:41:42", () => {
    const html = `<meta property="article:published_time" content="2026-07-09 18:41:42">`;
    expect(extractPublishedAt(html)).toBe("2026-07-09");
  });

  it("屬性順序顛倒也讀得到", () => {
    const html = `<meta content="2026-03-02T10:00:00Z" property="article:published_time">`;
    expect(extractPublishedAt(html)).toBe("2026-03-02");
  });

  it("meta 優先於 ld+json —— 兩者衝突時以文章自己的標記為準", () => {
    const html = `
      <script type="application/ld+json">{"datePublished":"2020-01-01T00:00:00Z"}</script>
      <meta property="article:published_time" content="2026-07-09 18:41:42">`;
    expect(extractPublishedAt(html)).toBe("2026-07-09");
  });

  it("沒有任何標記時回 null，不猜", () => {
    expect(extractPublishedAt("<html><body>沒有日期</body></html>")).toBeNull();
  });

  it("標記在但值不是合法日期時回 null", () => {
    expect(extractPublishedAt(`<meta property="article:published_time" content="unknown">`)).toBeNull();
  });

  it("空字串不丟例外", () => {
    expect(extractPublishedAt("")).toBeNull();
  });
});
