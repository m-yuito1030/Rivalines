import { describe, expect, it } from 'vitest';
import { FARE_MUL_MAX, FARE_MUL_MIN, clampFareMul, fareDemand, fareMulOf } from './fares';

describe('運賃の倍率', () => {
  it('範囲に収め、0.1刻みに丸め、不正な値は1(標準)', () => {
    expect(clampFareMul(0.01)).toBe(FARE_MUL_MIN);
    expect(clampFareMul(99)).toBe(FARE_MUL_MAX);
    expect(clampFareMul(1.26)).toBe(1.3);
    expect(clampFareMul('x')).toBe(1);
    expect(clampFareMul(NaN)).toBe(1);
    expect(fareMulOf(undefined)).toBe(1);
    expect(fareMulOf({})).toBe(1);
    expect(fareMulOf({ fareMul: 1.5 })).toBe(1.5);
  });

  it('需要: 標準で1、高いと減り、安いと増える。収入(倍率×需要)には最大点がある', () => {
    expect(fareDemand(1)).toBe(1);
    expect(fareDemand(1.5)).toBeLessThan(1);
    expect(fareDemand(0.5)).toBeGreaterThan(1);
    const rev = (m: number) => m * fareDemand(m);
    expect(rev(1.1)).toBeGreaterThan(rev(1));
    expect(rev(1.1)).toBeGreaterThan(rev(2.5));
    expect(rev(1.1)).toBeGreaterThan(rev(0.5));
  });
});
