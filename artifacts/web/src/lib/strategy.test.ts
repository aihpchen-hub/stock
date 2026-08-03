import { describe, expect, it } from 'vitest';

import { strategyFor } from './strategy';

describe('strategyFor', () => {
  it('三個週期各自對應一種操作策略', () => {
    expect(strategyFor('1m').label).toBe('短線');
    expect(strategyFor('3m').label).toBe('波段');
    expect(strategyFor('6m').label).toBe('中長線');
  });

  it('附上持有期間，避免只有標籤看不出尺度', () => {
    expect(strategyFor('6m').detail).toContain('6');
  });

  it('週期缺失或不在規格內時退回基準週期，與後端 normalizePeriod 一致', () => {
    expect(strategyFor(undefined)).toEqual(strategyFor('3m'));
    expect(strategyFor(null)).toEqual(strategyFor('3m'));
    expect(strategyFor('99y')).toEqual(strategyFor('3m'));
  });
});
