import { describe, expect, it } from 'vitest';
import { eventsToday, facilityDayMul, facilityEvent, hash01, isHoliday, seasonMul, weatherMul, weatherOf } from './events';
import type { Facility } from '../world/facilities';

const f = (id: number, type: string) => ({ id, type }) as Facility;

describe('季節・天候・イベント', () => {
  it('乱数は決定論的で 0〜1 に収まる', () => {
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    for (let i = 0; i < 500; i++) {
      const v = hash01(20260401, i, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('天候: 同じ日は同じ。夏は雪にならず、冬は雪の日がある。雨の日が梅雨に多い', () => {
    expect(weatherOf(5, 10)).toBe(weatherOf(5, 10));
    let snowSummer = 0;
    let snowWinter = 0;
    let rainJune = 0;
    let rainMay = 0;
    for (let d = 0; d < 365 * 4; d++) {
      const w = weatherOf(9, d);
      const date = new Date(Date.UTC(2026, 3, 1 + d));
      const m = date.getUTCMonth() + 1;
      if (w === 'snow' && m >= 5 && m <= 10) snowSummer++;
      if (w === 'snow' && (m === 12 || m <= 2)) snowWinter++;
      if (w === 'rain' && m === 6) rainJune++;
      if (w === 'rain' && m === 5) rainMay++;
    }
    expect(snowSummer).toBe(0);
    expect(snowWinter).toBeGreaterThan(0);
    expect(rainJune).toBeGreaterThan(rainMay);
  });

  it('休日: 日曜(2026/4/5)と祝日(4/29)は休日、平日(4/2 木)は違う', () => {
    expect(isHoliday(4)).toBe(true); // 4/5 日
    expect(isHoliday(28)).toBe(true); // 4/29
    expect(isHoliday(1)).toBe(false); // 4/2 木
  });

  it('季節と天候: 雨の遊園地は減り、雨のモールは増える。冬の公園は夏より少ない', () => {
    expect(weatherMul('amusement', 'rain')).toBeLessThan(1);
    expect(weatherMul('mall', 'rain')).toBeGreaterThan(1);
    expect(seasonMul('park', 1)).toBeLessThan(seasonMul('park', 7));
    expect(weatherMul('hotel', 'snow')).toBe(1);
  });

  it('イベント: 日と施設で決まり、倍率が掛かる。イベントのない型は null', () => {
    expect(facilityEvent(3, f(1, 'school'), 5)).toBeNull();
    let hit = 0;
    for (let d = 0; d < 200; d++) {
      const e = facilityEvent(3, f(1, 'stadium'), d);
      if (e) {
        hit++;
        expect(e.mul).toBe(2.5);
        expect(facilityDayMul(3, f(1, 'stadium'), d)).toBeGreaterThan(1);
      }
    }
    expect(hit).toBeGreaterThan(10);
    expect(hit).toBeLessThan(120);
  });

  it('通知用: 自社の施設のイベントだけ集める', () => {
    const fs = [f(1, 'stadium'), f(2, 'stadium')];
    let day = 0;
    while (!(facilityEvent(3, fs[0], day) && facilityEvent(3, fs[1], day))) day++;
    expect(eventsToday(3, fs, day, (x) => x.id === 1)).toHaveLength(1);
    expect(eventsToday(3, fs, day, () => true)).toHaveLength(2);
  });
});
