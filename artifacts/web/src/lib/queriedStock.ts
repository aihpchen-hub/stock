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
    return stocks.some((s) => s.code === target) ? target : null;
  }

  return stocks.find((s) => s.name.trim() === target)?.code ?? null;
}
