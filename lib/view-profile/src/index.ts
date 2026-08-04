/**
 * 受眾視圖設定。
 *
 * 為什麼是一張查表而不是模型輸出：`hide_sections` 是 `user_profile` 的純函式，
 * 交給模型等於用 16~20 秒延遲與有限的 Gemini 額度，去換一個 `Record` 查表
 * 就有的答案，還多了幻覺風險。更關鍵的是，卡片上的「扣費後風報比」依賴
 * `settings.feeDiscount` —— 使用者在瀏覽器設定的券商折扣，從未離開前端 ——
 * 模型在物理上算不出來，只會編造一個看起來合理的數字。
 *
 * 為什麼是前端而不是 API：切換受眾若走 API，每次都要重打一次分析；放前端
 * 則是 `useState`，而且舊 localStorage 快照天生相容 —— profile 是當下選的，
 * 不需要像 `advice`／`invalidation` 那樣再寫一套補算。
 *
 * 這個套件只被 Vite 消費，因此可以直接匯出 `.ts`（比照 `lib/api-zod`）。
 * **不要**改成匯出編譯後的 JS —— `lib/advice` 那樣做是因為它進了 Netlify
 * 函式的相依圖，而這個套件不會。
 */

export type ViewProfile = 'newbie' | 'momentum' | 'swing' | 'value' | 'dividend';

export type SectionKey =
  /** 加權期望值與三情境機率 */
  | 'expected_value'
  /** 該規則版本的實測達標率 */
  | 'verified_rate'
  /** 相對大盤與同族群排名 */
  | 'market_strength'
  /** 三大法人多天期買賣超 */
  | 'chips'
  | 'monthly_yoy'
  | 'ma_position'
  | 'volume'
  /** 訊號徽章與趨勢 */
  | 'signals'
  /** trendBasis 與各項訊號的計算值 */
  | 'signal_details'
  /** 模板摘要句 */
  | 'narrative'
  /** 進場區、停損、停利 */
  | 'trading_plan'
  /** 把交易計畫的價位、均線與近 20 日高低畫在同一根真實比例的軸上 */
  | 'price_map'
  /** 建議張數、風報比、單張最大虧損 */
  | 'position_sizing'
  /** 第一目標 1R 與移動停損起始 */
  | 'trailing_stop'
  /** 這份計畫何時失效 */
  | 'invalidation'
  /** PE／PB／殖利率的五年區間百分位 */
  | 'valuation'
  /** 連續配息年數與填息紀錄 */
  | 'dividend'
  /** 毛利率、ROE、負債比、自由現金流 */
  | 'financials';

export interface ViewConfig {
  label: string;
  /** 切換器上的一句話說明，同時是這個視圖的定位宣告 */
  description: string;
  /**
   * 必須讓使用者知道的限制。動能視圖有值，因為日線資料延遲一天 ——
   * 不寫清楚就等於默許使用者拿它做當沖。
   */
  caveat: string | null;
  show: SectionKey[];
  /** newbie 走白話文對照表，其餘沿用原本的技術用語 */
  glossary: 'plain' | 'technical';
}

/**
 * 各受眾看得到的區塊。
 *
 * 操作建議橫幅（AdviceBanner）與資料日期不列入 —— 它們在所有視圖都必須顯示，
 * 沒有任何一種投資人可以不知道「現在能不能買」與「這是哪一天的資料」。
 */
export const VIEW_CONFIG: Record<ViewProfile, ViewConfig> = {
  newbie: {
    label: '新手',
    description: '只看能不能買、最壞會賠多少',
    caveat: null,
    // 砍掉 E(V) 與三情境不是因為難懂，是因為那張機率表未經回測，
    // 而它用最大的字級印給最沒有判斷力的族群。
    show: [
      'verified_rate',
      'narrative',
      'market_strength',
      'volume',
      'price_map',
      'trading_plan',
      'position_sizing',
      'invalidation',
    ],
    glossary: 'plain',
  },
  momentum: {
    label: '動能',
    description: '關鍵價位、量能、近期籌碼',
    // 日線延遲一天，README 亦註明不適合當日操作。定位必須寫在畫面上。
    caveat: '數日～數週的動能與突破。日線資料延遲一天，不支援當沖與隔日沖。',
    show: [
      'market_strength',
      'volume',
      'ma_position',
      'chips',
      'signals',
      'signal_details',
      'price_map',
      'trading_plan',
      'position_sizing',
      'invalidation',
    ],
    glossary: 'technical',
  },
  swing: {
    label: '波段',
    description: '完整交易計畫與期望值（預設）',
    caveat: null,
    show: [
      'expected_value',
      'verified_rate',
      'market_strength',
      'chips',
      'monthly_yoy',
      'ma_position',
      'volume',
      'signals',
      'signal_details',
      'narrative',
      'price_map',
      'trading_plan',
      'position_sizing',
      'trailing_stop',
      'invalidation',
    ],
    glossary: 'technical',
  },
  value: {
    label: '價值',
    description: '估值區間、財務品質、護城河數據',
    caveat: null,
    // 停損停利與價值投資邏輯牴觸：賣出條件是基本面轉壞或估值過高，
    // 不是價格觸及某個數字。整個交易計畫區塊因此不顯示。
    show: ['valuation', 'financials', 'dividend', 'monthly_yoy', 'chips', 'market_strength'],
    glossary: 'technical',
  },
  dividend: {
    label: '存股',
    description: '殖利率、連續配息、填息紀錄',
    caveat: null,
    show: ['dividend', 'valuation', 'financials', 'market_strength'],
    glossary: 'technical',
  },
};

/** 切換器用的順序。新手在前、專業視圖在後 */
export const PROFILES: ViewProfile[] = ['newbie', 'momentum', 'swing', 'value', 'dividend'];

/** 系統預設。與既有畫面行為一致 —— 沒選過的人不該看到畫面突然變樣 */
export const DEFAULT_PROFILE: ViewProfile = 'swing';

export function viewFor(profile?: string | null): ViewConfig {
  return VIEW_CONFIG[(profile ?? '') as ViewProfile] ?? VIEW_CONFIG[DEFAULT_PROFILE];
}

/** 這個視圖要不要顯示某個區塊 */
export function shows(profile: string | null | undefined, section: SectionKey): boolean {
  return viewFor(profile).show.includes(section);
}

/**
 * 新手視圖的術語翻譯。
 *
 * 只翻譯，不改變判斷 —— 同一個 maSignal 在兩種視圖是同一件事，
 * 差別只在用哪一套詞講。
 */
const PLAIN_MA: Record<string, string> = {
  above_both: '股價在近月與近季平均之上（偏強）',
  above_ma20: '股價在近月平均之上、近季平均之下（中性偏強）',
  below_both: '股價在近月與近季平均之下（偏弱）',
};

const TECHNICAL_MA: Record<string, string> = {
  above_both: '站上雙均線',
  above_ma20: '僅站上月線',
  below_both: '跌破雙均線',
};

export function maSignalText(signal: string | null | undefined, glossary: 'plain' | 'technical'): string {
  const table = glossary === 'plain' ? PLAIN_MA : TECHNICAL_MA;
  return table[signal ?? ''] ?? '資料不足';
}
