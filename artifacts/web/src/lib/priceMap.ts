/**
 * 價位地圖的排版計算。
 *
 * 把交易計畫的各個價位放到同一根真實比例的軸上，回答的是單看數字答不出來的
 * 兩個問題：現價離停損還有多遠，以及進場區究竟落在月線之上還是之下。
 *
 * 這裡只算位置，不畫任何東西 —— 判斷全部留在純函式裡，元件只負責把回傳值
 * 貼到畫面上。
 */

import type { PlanKind } from '@workspace/advice';

export type PriceMapKey =
  | 'take_profit'
  | 'swing_high'
  | 'first_target'
  | 'entry_high'
  | 'entry_low'
  | 'current'
  | 'ma20'
  | 'ma60'
  | 'stop_loss'
  | 'trailing_stop'
  | 'swing_low';

/**
 * 這條線是要抄進下單畫面的數字，還是用來判斷那些數字合不合理的背景。
 *
 * 這張圖現在是卡片上唯一一份價位陳述（先前同一組數字在三個地方各印一次），
 * 因此它必須自己分出主次 —— 全部同一個字級等於沒有分。
 */
export type PriceMapEmphasis = 'primary' | 'context';

export interface PriceMapInput {
  planKind: PlanKind;
  /** 用詞。與 `maSignalText` 同一個開關，預設沿用技術用語 */
  glossary?: 'plain' | 'technical';
  currentPrice?: number | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  firstTarget?: number | null;
  ma20?: number | null;
  ma60?: number | null;
  trailingStop?: number | null;
  swingHigh?: number | null;
  swingLow?: number | null;
}

export interface PriceMapLevel {
  key: PriceMapKey;
  label: string;
  /** 主要價位用大字，背景用小字 */
  emphasis: PriceMapEmphasis;
  value: number;
  /** 刻度線的位置。0 是軸底、100 是軸頂，永遠是真實比例 */
  pct: number;
  /** 標籤實際畫的位置。去疊之後可能與 pct 不同 */
  labelPct: number;
  /** 與現價的距離（%）。現價本身、或缺現價時為 null */
  fromCurrent: number | null;
}

/**
 * 軸的上下邊距。
 *
 * 沒有邊距時最高與最低價會貼在容器邊緣上，標籤被切一半。
 */
const AXIS_PADDING = 8;

/**
 * 兩個標籤之間至少要留的距離（單位同 pct）。
 *
 * 價位靠得近時（例如進場上下緣只差一檔）標籤會疊成一團看不清，
 * 但刻度線不能跟著移動 —— 移了這張圖就不是真實比例了。
 */
export const LABEL_MIN_GAP = 8;

const LABELS: Record<PriceMapKey, string> = {
  take_profit: '停利',
  swing_high: '20日高',
  first_target: '第一目標',
  entry_high: '進場上緣',
  entry_low: '進場下緣',
  current: '現價',
  ma20: '月線',
  ma60: '季線',
  stop_loss: '停損',
  trailing_stop: '移動停損起始',
  swing_low: '20日低',
};

/**
 * 要抄進下單畫面的價位（primary），與判斷那些價位合不合理的背景（context）。
 *
 * 這張圖現在是卡片上唯一一份價位陳述 —— 先前同一組數字在交易計畫三欄、
 * 地圖標籤、1R 灰籤三個地方各印一次。既然合成一份，它就得自己分主次。
 */
const CONTEXT_KEYS: ReadonlySet<PriceMapKey> = new Set<PriceMapKey>([
  'ma20',
  'ma60',
  'swing_high',
  'swing_low',
]);

/**
 * 新手視圖的用詞。只有均線需要翻譯。
 *
 * 停損、停利、20 日高低在新手視圖的其他區塊本來就是這樣寫的（交易計畫、
 * 停損依據），跟著改反而會讓同一張卡片出現兩套詞 —— 那正是要避免的事。
 */
const PLAIN_LABELS: Partial<Record<PriceMapKey, string>> = {
  ma20: '近月均價',
  ma60: '近季均價',
};

/**
 * 這張圖旁邊要說的話。沒有要說的事時回 null。
 *
 * conditional 那一則是必要的：卡片的操作建議寫「站回 X 之上這份計畫才成立」、
 * 交易計畫標題寫「尚未成立」、欄位寫「成立後進場區」—— 地圖若照畫一條進場帶
 * 而不出一聲，它會是整張卡片上唯一讓人以為現在就能買的東西。
 */
export function priceMapNote(planKind: PlanKind): string | null {
  if (planKind === 'none') {
    return '僅顯示現價與均線位置 —— 進場區與停損停利的前提不成立，見上方操作建議。';
  }
  if (planKind === 'conditional') {
    return '進場區與停損停利是站回月線之後才成立的價位，現在還不能照著下單。';
  }
  return null;
}

/**
 * 交易計畫的價位。`planKind` 為 none 時整組不畫。
 *
 * 那個狀態代表現價已跌破停損或資料不足，卡片上的交易計畫區塊已經整塊換成
 * 「目前不提供進場區間與停損停利」。地圖若照畫，等於把剛抑制掉的矛盾
 * 用圖再講一次。
 */
const PLAN_KEYS: ReadonlySet<PriceMapKey> = new Set<PriceMapKey>([
  'take_profit',
  'first_target',
  'entry_high',
  'entry_low',
  'stop_loss',
  'trailing_stop',
]);

export function buildPriceMap(input: PriceMapInput): PriceMapLevel[] {
  const showPlan = input.planKind !== 'none';

  const candidates: Array<[PriceMapKey, number | null | undefined]> = [
    ['take_profit', input.takeProfit],
    ['swing_high', input.swingHigh],
    ['first_target', input.firstTarget],
    ['entry_high', input.entryHigh],
    ['entry_low', input.entryLow],
    ['current', input.currentPrice],
    ['ma20', input.ma20],
    ['ma60', input.ma60],
    ['stop_loss', input.stopLoss],
    ['trailing_stop', input.trailingStop],
    ['swing_low', input.swingLow],
  ];

  const picked = candidates
    .filter(([key]) => showPlan || !PLAN_KEYS.has(key))
    .filter((entry): entry is [PriceMapKey, number] => Number.isFinite(entry[1]))
    .sort((a, b) => a[1] - b[1]);

  if (picked.length === 0) return [];

  const values = picked.map(([, value]) => value);
  const min = values[0]!;
  const max = values[values.length - 1]!;
  const span = max - min;

  const current = Number.isFinite(input.currentPrice) ? (input.currentPrice as number) : null;

  const levels: PriceMapLevel[] = picked.map(([key, value]) => {
    // 全部價位相同（或只有一個）時除數為零 —— 放中間，不製造 NaN
    const pct = span === 0 ? 50 : AXIS_PADDING + ((value - min) / span) * (100 - AXIS_PADDING * 2);
    return {
      key,
      label: (input.glossary === 'plain' ? PLAIN_LABELS[key] : undefined) ?? LABELS[key],
      emphasis: CONTEXT_KEYS.has(key) ? 'context' : 'primary',
      value,
      pct,
      labelPct: pct,
      fromCurrent:
        current == null || current === 0 || key === 'current'
          ? null
          : ((value - current) / current) * 100,
    };
  });

  return spreadLabels(levels);
}

/**
 * 把疊在一起的標籤推開。
 *
 * 先由下往上推，推到頂端外的再由上往下回推 —— 只往上推會讓價位擠在軸頂時
 * 最後幾個標籤跑到畫布外，那等於沒有標籤。只改 labelPct，pct 不動。
 */
function spreadLabels(levels: PriceMapLevel[]): PriceMapLevel[] {
  for (let i = 1; i < levels.length; i++) {
    const previous = levels[i - 1]!.labelPct;
    levels[i]!.labelPct = Math.max(levels[i]!.labelPct, previous + LABEL_MIN_GAP);
  }

  const highest = levels[levels.length - 1]!;
  if (highest.labelPct > 100) {
    highest.labelPct = 100;
    for (let i = levels.length - 2; i >= 0; i--) {
      const above = levels[i + 1]!.labelPct;
      levels[i]!.labelPct = Math.max(0, Math.min(levels[i]!.labelPct, above - LABEL_MIN_GAP));
    }
  }

  return levels;
}
