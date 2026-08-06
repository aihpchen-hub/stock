/**
 * 這次查詢指向的那一檔個股。
 *
 * 後端在關鍵字是代號時，已經要求模型把該檔放在 stocks 的第一筆
 * （`routes/analyze.ts` 的 prompt），但前端依 E(V) 重排會蓋掉那個順序 ——
 * 查 5439 卻要滑到最下面才找得到自己查的股票。這個函式讓畫面能把它認出來。
 *
 * 查產業關鍵字時回 null：那種查詢本來就不指向特定一檔，硬指一個等於
 * 在畫面上宣稱一件使用者沒做的事。
 */

interface StockLike {
  code: string;
  name: string;
}

/** 四到六位純數字視為台股代號，與後端 `isStockCode` 同一套規則 */
const CODE_PATTERN = /^\d{4,6}$/;

/**
 * 找出 keyword 指向的代號，找不到回 null。
 *
 * 刻意只做完全比對。部分比對會讓「台」誤中台燿、「金像電子」誤中金像電，
 * 而一個錯誤的「你查的」標記比沒有標記更糟：它看起來像已經確認過。
 */
export function queriedCode(
  keyword: string,
  stocks: ReadonlyArray<StockLike>,
): string | null {
  const target = keyword.trim();
  if (target.length === 0) return null;

  if (CODE_PATTERN.test(target)) {
    return stocks.some((s) => s?.code === target) ? target : null;
  }

  // 後端的 sanitizeStocks 已經擋掉缺欄位的標的，但 localStorage 裡的舊快照
  // 是在那之前存的。這個函式在 render 期間的 useMemo 內被呼叫，丟例外
  // 等於整棵樹卸載、畫面全白 —— 一筆三個月前的壞紀錄不該有那個殺傷力。
  return stocks.find((s) => String(s?.name ?? "").trim() === target)?.code ?? null;
}

export interface QueriedIdentity {
  code: string;
  /** 官方簡稱優先，其次模型給的名稱 */
  name: string;
  /** 官方產業別。明細尚未載入或缺欄位時為 null */
  industry: string | null;
}

interface DetailLike {
  stockName?: string | null;
  officialIndustry?: string | null;
}

/**
 * 查詢標的的完整身分。
 *
 * 分析頁的標題印的是使用者輸入的字串 —— 查 5439 時整頁最大的字就是「5439」，
 * 沒有公司名、沒有產業，也看不出這是個股查詢還是產業查詢。
 *
 * 官方簡稱與官方產業別優先：那是證交所／櫃買中心的資料，是這份回傳裡唯一
 * 可查核的名稱來源。明細還在載入時退回模型給的名稱，讓標題先有東西可看。
 */
export function queriedIdentity(
  keyword: string,
  stocks: ReadonlyArray<StockLike>,
  details: Readonly<Record<string, DetailLike>>,
): QueriedIdentity | null {
  const code = queriedCode(keyword, stocks);
  if (code === null) return null;

  const detail = details[code];
  return {
    code,
    name: detail?.stockName ?? stocks.find((s) => s.code === code)?.name ?? code,
    industry: detail?.officialIndustry ?? null,
  };
}
