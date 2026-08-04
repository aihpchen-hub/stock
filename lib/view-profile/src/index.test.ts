import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROFILE,
  PROFILES,
  VIEW_CONFIG,
  maSignalText,
  shows,
  viewFor,
  type ViewProfile,
} from './index';

describe('viewFor', () => {
  it('認得的受眾回傳自己的設定', () => {
    expect(viewFor('newbie').label).toBe('新手');
    expect(viewFor('value').label).toBe('價值');
  });

  it('未知、缺失或空字串一律退回預設 —— 與 strategyFor 的處理一致', () => {
    expect(viewFor(undefined)).toBe(VIEW_CONFIG[DEFAULT_PROFILE]);
    expect(viewFor(null)).toBe(VIEW_CONFIG[DEFAULT_PROFILE]);
    expect(viewFor('')).toBe(VIEW_CONFIG[DEFAULT_PROFILE]);
    expect(viewFor('day_trader')).toBe(VIEW_CONFIG[DEFAULT_PROFILE]);
  });

  it('預設是波段 —— 沒選過的人不該看到畫面突然變樣', () => {
    expect(DEFAULT_PROFILE).toBe('swing');
  });
});

describe('VIEW_CONFIG', () => {
  it('每個受眾都至少看得到一個區塊，沒有空白視圖', () => {
    for (const p of PROFILES) {
      expect(VIEW_CONFIG[p].show.length).toBeGreaterThan(0);
    }
  });

  it('切換器清單涵蓋所有設定，兩者不會長歪', () => {
    expect([...PROFILES].sort()).toEqual((Object.keys(VIEW_CONFIG) as ViewProfile[]).sort());
  });

  it('每個受眾的區塊清單沒有重複項', () => {
    for (const p of PROFILES) {
      expect(new Set(VIEW_CONFIG[p].show).size).toBe(VIEW_CONFIG[p].show.length);
    }
  });

  it('波段是超集 —— 它是既有行為，不該少掉任何其他視圖有的東西', () => {
    const swing = new Set(VIEW_CONFIG.swing.show);
    for (const p of PROFILES) {
      if (p === 'swing') continue;
      for (const section of VIEW_CONFIG[p].show) {
        // 估值三塊是新資料，波段不看；其餘都該在波段裡
        if (['valuation', 'dividend', 'financials'].includes(section)) continue;
        expect(swing.has(section)).toBe(true);
      }
    }
  });
});

describe('各受眾的關鍵排除', () => {
  it('新手看不到期望值 —— 那張機率表未經回測，卻是全卡最大的字', () => {
    expect(shows('newbie', 'expected_value')).toBe(false);
  });

  it('新手看不到移動停損與訊號計算值這類術語', () => {
    expect(shows('newbie', 'trailing_stop')).toBe(false);
    expect(shows('newbie', 'signal_details')).toBe(false);
  });

  it('新手看得到最壞會賠多少 —— 那是他唯一該記住的數字', () => {
    expect(shows('newbie', 'position_sizing')).toBe(true);
  });

  it('動能看不到月營收 YoY —— 對做突破的人是純雜訊', () => {
    expect(shows('momentum', 'monthly_yoy')).toBe(false);
  });

  it('動能看得到量能與近期籌碼', () => {
    expect(shows('momentum', 'volume')).toBe(true);
    expect(shows('momentum', 'chips')).toBe(true);
  });

  it('價值與存股都看不到交易計畫 —— 停損停利與長期持有邏輯牴觸', () => {
    for (const p of ['value', 'dividend'] as const) {
      expect(shows(p, 'trading_plan')).toBe(false);
      expect(shows(p, 'position_sizing')).toBe(false);
      expect(shows(p, 'trailing_stop')).toBe(false);
      expect(shows(p, 'invalidation')).toBe(false);
    }
  });

  it('價值與存股看得到估值與財報，那是它們唯一的決策依據', () => {
    for (const p of ['value', 'dividend'] as const) {
      expect(shows(p, 'valuation')).toBe(true);
      expect(shows(p, 'financials')).toBe(true);
    }
  });

  it('存股看得到股利，那是這個族群的核心', () => {
    expect(shows('dividend', 'dividend')).toBe(true);
  });

  it('價值與存股看不到價位地圖 —— 它畫的就是停損停利，與上一條同一個理由', () => {
    expect(shows('value', 'price_map')).toBe(false);
    expect(shows('dividend', 'price_map')).toBe(false);
  });

  it('有交易計畫的三個視圖都看得到價位地圖', () => {
    for (const p of ['newbie', 'momentum', 'swing'] as const) {
      expect(shows(p, 'price_map')).toBe(true);
    }
  });

  it('看得到價位地圖的視圖必定也看得到交易計畫 —— 地圖畫的就是那組價位', () => {
    for (const p of PROFILES) {
      if (shows(p, 'price_map')) expect(shows(p, 'trading_plan')).toBe(true);
    }
  });

  it('相對強弱在每個視圖都看得到 —— 沒有基準的趨勢對誰都可能講反', () => {
    for (const p of PROFILES) {
      expect(shows(p, 'market_strength')).toBe(true);
    }
  });
});

describe('caveat', () => {
  it('動能必須標明不支援當沖 —— 日線資料延遲一天', () => {
    expect(VIEW_CONFIG.momentum.caveat).toContain('當沖');
  });

  it('其他視圖沒有這個限制', () => {
    expect(VIEW_CONFIG.swing.caveat).toBeNull();
    expect(VIEW_CONFIG.value.caveat).toBeNull();
  });
});

describe('maSignalText', () => {
  it('新手看白話文，不出現「雙均線」這個詞', () => {
    const text = maSignalText('above_both', 'plain');
    expect(text).toContain('近月');
    expect(text).not.toContain('均線');
  });

  it('其他視圖沿用原本的技術用語', () => {
    expect(maSignalText('above_both', 'technical')).toBe('站上雙均線');
  });

  it('兩套詞講的是同一個判斷，只是用詞不同', () => {
    expect(maSignalText('below_both', 'plain')).toContain('偏弱');
    expect(maSignalText('below_both', 'technical')).toBe('跌破雙均線');
  });

  it('未知或缺值一律回資料不足，不顯示原始列舉值', () => {
    expect(maSignalText(null, 'plain')).toBe('資料不足');
    expect(maSignalText('insufficient_data', 'technical')).toBe('資料不足');
    expect(maSignalText('something_new', 'plain')).toBe('資料不足');
  });
});
