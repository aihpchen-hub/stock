import { describe, expect, it } from "vitest";

import {
  NEWS_DOMAINS,
  countMatches,
  isAllowedNewsUrl,
  keywordTerms,
  mentionsTarget,
} from "./newsSources";

describe("白名單網域", () => {
  it("放行主網域本身", () => {
    expect(isAllowedNewsUrl("https://cnyes.com/news/id/123")).toBe(true);
  });

  it("放行子網域", () => {
    expect(isAllowedNewsUrl("https://news.cnyes.com/news/id/123")).toBe(true);
    expect(isAllowedNewsUrl("https://tw.stock.finance.yahoo.com/q/q?s=2330")).toBe(true);
  });

  it("擋掉把白名單當前綴的偽造網域", () => {
    // 用 includes() 比對整串網址會誤放這種網址
    expect(isAllowedNewsUrl("https://cnyes.com.evil.example/fake")).toBe(false);
    expect(isAllowedNewsUrl("https://evil.example/?ref=cnyes.com")).toBe(false);
  });

  it("擋掉 Tavily 回退全網時撈到的無關來源", () => {
    // 搜「8111」實際撈回來的東西：美國佛州法案與亞特蘭大的康復中心
    expect(isAllowedNewsUrl("https://www.flsenate.gov/Session/Bill/2024/8111")).toBe(false);
    expect(isAllowedNewsUrl("https://en.wikipedia.org/wiki/8111")).toBe(false);
  });

  it("解析不了的網址視為不可信", () => {
    expect(isAllowedNewsUrl("not a url")).toBe(false);
    expect(isAllowedNewsUrl("")).toBe(false);
  });

  it("大小寫不影響判斷", () => {
    expect(isAllowedNewsUrl("https://NEWS.CNYES.COM/news/id/1")).toBe(true);
  });

  it("白名單中每個網域都放行自己", () => {
    for (const domain of NEWS_DOMAINS) {
      expect(isAllowedNewsUrl(`https://${domain}/x`)).toBe(true);
    }
  });
});

describe("是否提及目標", () => {
  const target = ["立碁", "8111"];

  it("提及公司名即算命中", () => {
    expect(
      mentionsTarget("立碁攜手千才、荷蘭PHIX 跨國推動3.2T矽光子模組開發計畫", target),
    ).toBe(true);
  });

  it("只提及代號也算命中", () => {
    expect(mentionsTarget("光電族群 8111 走揚", target)).toBe(true);
  });

  it("代號不可命中更長數字中的片段", () => {
    // 實測誤留：「台股收在 28111 點」被當成立碁的新聞
    expect(mentionsTarget("台股收在 28111 點創新高", target)).toBe(false);
    expect(mentionsTarget("成交金額 81110 萬元", target)).toBe(false);
    expect(mentionsTarget("代號81112的其他標的", target)).toBe(false);
  });

  it("代號前後為非數字字元時正常命中", () => {
    expect(mentionsTarget("(8111)立碁", target)).toBe(true);
    expect(mentionsTarget("8111", target)).toBe(true);
  });

  it("同來源但不相關的文章判為未提及", () => {
    // 查「軌道扣件防蝕塗層」時 Tavily 從白名單內撈回的 PCB 新聞
    expect(mentionsTarget("欣興、弘塑受惠ABF載板需求回溫", target)).toBe(false);
  });

  it("英文關鍵字不分大小寫", () => {
    expect(mentionsTarget("Taiwan CPO supply chain outlook", ["cpo"])).toBe(true);
    expect(mentionsTarget("台廠搶進 cpo 市場", ["CPO"])).toBe(true);
  });

  it("空白詞不會造成全部命中", () => {
    expect(mentionsTarget("任意內容", ["", "   "])).toBe(false);
  });

  it("沒有比對詞時判為未提及，不預設放行", () => {
    expect(mentionsTarget("任意內容", [])).toBe(false);
  });
});

describe("keywordTerms", () => {
  it("取出所有連續兩字組合", () => {
    expect(keywordTerms("散熱模組").sort()).toEqual(["熱模", "模組", "散熱"].sort());
  });

  it("兩字以內的關鍵字原樣保留", () => {
    expect(keywordTerms("CPO")).toEqual(["CP", "PO"]);
    expect(keywordTerms("記憶")).toEqual(["記憶"]);
    expect(keywordTerms("A")).toEqual(["A"]);
  });

  it("去除空白與標點，不產生跨詞的無意義組合", () => {
    expect(keywordTerms("AI 散熱")).toEqual(keywordTerms("AI散熱"));
    expect(keywordTerms("矽光子／CPO")).not.toContain("子／");
  });

  it("重複的組合只留一份", () => {
    expect(keywordTerms("熱熱熱")).toEqual(["熱熱"]);
  });

  it("空字串回傳空陣列（不會變成命中一切）", () => {
    expect(keywordTerms("")).toEqual([]);
    expect(keywordTerms("   ")).toEqual([]);
  });

  it("保留相關報導、剔除同來源的無關報導", () => {
    // 實測案例：查「軌道扣件防蝕塗層」時 Tavily 從白名單內撈回 PCB 新聞，
    // 模型據此給出欣興、弘塑等完全無關的標的
    const rail = keywordTerms("軌道扣件防蝕塗層");
    expect(mentionsTarget("博通：台積電產能、雷射與PCB為2026年供應鏈瓶頸", rail)).toBe(false);
    expect(mentionsTarget("台鐵軌道扣件更新標案 防蝕塗層供應商入列", rail)).toBe(true);

    // 反向：語意相關但用詞不同的報導仍應保留（整串比對會漏掉）
    const cooling = keywordTerms("AI水冷散熱");
    expect(mentionsTarget("液冷散熱需求爆發，台廠受惠", cooling)).toBe(true);
  });
});

describe("countMatches 排序依據", () => {
  const cooling = keywordTerms("AI水冷散熱"); // AI, I水, 水冷, 冷散, 散熱

  it("談得越具體命中越多", () => {
    const specific = countMatches("AI伺服器水冷散熱模組出貨放量", cooling);
    const generic = countMatches("AI浪潮帶動台股上攻", cooling);
    expect(specific).toBeGreaterThan(generic);
    expect(generic).toBe(1); // 僅命中 AI
  });

  it("同一個詞出現多次只計一次", () => {
    expect(countMatches("散熱散熱散熱", cooling)).toBe(1);
  });

  it("完全不相關為零", () => {
    expect(countMatches("台灣觀光業復甦", cooling)).toBe(0);
  });

  it("重複的比對詞不會重複計分", () => {
    expect(countMatches("立碁", ["立碁", "立碁", " 立碁 "])).toBe(1);
  });
});
