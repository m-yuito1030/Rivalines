import { describe, expect, it } from 'vitest';
import { stopLabelVisibleAt } from './stopLabels';

describe('駅名ラベル', () => {
  it('小さい停留所(バス停)ほど、寄ったときだけ名前を出す', () => {
    expect(stopLabelVisibleAt('rail', 0.2)).toBe(true);
    expect(stopLabelVisibleAt('road', 0.2)).toBe(false);
    expect(stopLabelVisibleAt('road', 0.3)).toBe(true);
    expect(stopLabelVisibleAt('air', 0.1)).toBe(false);
    expect(stopLabelVisibleAt('rail', 0.02)).toBe(false);
  });
});
