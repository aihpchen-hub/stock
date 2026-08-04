/**
 * 同一條供應鏈內的相對強弱排名。
 *
 * `/analyze` 已經算出 3~5 檔同族群標的，而 `analysis.tsx` 握有它們全部的
 * 明細 —— 排名因此完全在前端算，不需要任何額外的 API 請求。
 *
 * 為什麼要有：大盤相對強弱回答「這檔贏不贏大盤」，族群排名回答
 * 「同一條供應鏈裡它排第幾」。兩者不能互相取代 —— 整個族群一起強於大盤時，
 * 只看大盤 RS 會覺得每一檔都很好。
 *
 * 用 20 日報酬排序：5 日太短會被單日跳動主導，60 日又慢到反映不出近期輪動。
 * 這個選擇只影響排序依據，不進評分。
 */

export interface GroupRank {
  /** 1 起算，數字越小越強。同分同名次 */
  rank: number;
  /** 參與排名的檔數（不含缺報酬者） */
  total: number;
  leader: boolean;
  laggard: boolean;
}

export function rankByStrength(
  entries: Array<{ code: string; return20d: number | null }>,
): Record<string, GroupRank> {
  // 缺報酬的不參與，也不佔名次 —— 讓它佔一個位置會把其他檔的名次往後推，
  // 使用者看到的「第 3/5 強」就與實際可比的檔數對不起來。
  // NaN 與 Infinity 一併視同缺值：它們排得出順序，但那個順序沒有意義。
  const usable = entries.filter(
    (e): e is { code: string; return20d: number } =>
      e.return20d !== null && Number.isFinite(e.return20d),
  );

  const total = usable.length;
  const sorted = [...usable].sort((a, b) => b.return20d - a.return20d);

  const out: Record<string, GroupRank> = {};
  sorted.forEach((entry, i) => {
    // 同分同名次：名次取「第一個同分者的索引 + 1」，因此不受輸入順序影響
    const rank = sorted.findIndex((e) => e.return20d === entry.return20d) + 1;
    out[entry.code] = {
      rank,
      total,
      // 只有一檔可比時不標最強也不標最弱 —— 一檔的排名沒有意義。
      // laggard 額外排除 rank === 1：全部同分時每個人都是並列第一，
      // 那不該有人被標成落後。
      leader: total > 1 && rank === 1,
      laggard: total > 1 && i === total - 1 && rank !== 1,
    };
  });

  return out;
}
