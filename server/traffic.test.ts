import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TrafficMeter, msgType } from './traffic';

describe('通信量の計測', () => {
  it('メッセージの種類を、JSON の最初の type から取り出す', () => {
    expect(msgType('{"type":"frame","tick":1}')).toBe('frame');
    expect(msgType('{"type":"chunk","cx":1}')).toBe('chunk');
    expect(msgType('{"tick":1}')).toBe('other');
    expect(msgType('')).toBe('other');
  });

  it('送った大きさを、合計と種類ごとに数える(日本語は UTF-8 のバイト数)', () => {
    const m = new TrafficMeter();
    const frame = JSON.stringify({ type: 'frame', veh: [], note: 'あ' });
    m.sent(frame);
    m.sent(frame);
    m.sent(JSON.stringify({ type: 'misc', a: 1 }));
    m.received(30);
    m.presence(2, 10); // 2 人が 10 秒 = 20 人·秒
    const s = m.snapshot();
    expect(s.out.msgs).toBe(3);
    expect(s.out.bytes).toBe(Buffer.byteLength(frame) * 2 + Buffer.byteLength(JSON.stringify({ type: 'misc', a: 1 })));
    expect(Object.keys(s.byType)).toEqual(['frame', 'misc']); // 大きい順
    expect(s.byType.frame.msgs).toBe(2);
    expect(s.byType.frame.share + s.byType.misc.share).toBeCloseTo(1, 5);
    expect(s.in).toEqual({ msgs: 1, bytes: 30 });
    expect(s.playerSeconds).toBe(20);
    expect(s.perPlayer.outBps).toBe(Math.round(s.out.bytes / 20));
    expect(s.perPlayer.inBps).toBe(Math.round(30 / 20));
  });

  it('1 か月の見積もりは、1 人あたりの量 × 人数 × 30日で出る', () => {
    const m = new TrafficMeter();
    m.sent(JSON.stringify({ type: 'frame', pad: 'x'.repeat(1000) }));
    m.presence(1, 1);
    const s = m.snapshot();
    expect(s.monthlyOutGB['10人']).toBeCloseTo((s.perPlayer.outBps * 10 * 30 * 24 * 3600) / 1e9, 6);
    expect(s.monthlyOutGB['100人']).toBeCloseTo(s.monthlyOutGB['10人'] * 10, 6);
  });

  it('人がいなければ、1 人あたりは 0(0 で割らない)', () => {
    const m = new TrafficMeter();
    m.sent(JSON.stringify({ type: 'frame' }));
    const s = m.snapshot();
    expect(s.perPlayer).toEqual({ outBps: 0, inBps: 0 });
    expect(m.summary(s)).toContain('平均0.0人');
  });

  it('一部のメッセージを実際に圧縮してみて、圧縮した場合の割合を見積もる(同じ形の繰り返しなら小さくなる)', () => {
    const m = new TrafficMeter(1); // 全件を試す
    const big = JSON.stringify({ type: 'frame', veh: Array.from({ length: 60 }, (_, i) => ({ id: i, routeId: 3, modelId: 'bus', state: 'move', load: 4, cap: 30 })) });
    for (let i = 0; i < 5; i++) m.sent(big);
    const s = m.snapshot();
    expect(s.zipRatio).not.toBeNull();
    expect(s.zipRatio!).toBeLessThan(0.3);
    expect(s.byType.frame.zipRatio!).toBeLessThan(0.3);
    expect(m.summary(s)).toMatch(/圧縮すると約\d+%/);
  });

  it('小さいメッセージは圧縮を試さない。リセットで 0 に戻る。記録は 1 行の JSON で追記できる', () => {
    const m = new TrafficMeter(1);
    m.sent(JSON.stringify({ type: 'res', ok: true }));
    expect(m.snapshot().zipRatio).toBeNull();
    m.presence(1, 5);
    m.sent(JSON.stringify({ type: 'frame', pad: 'y'.repeat(500) }));
    const file = join(mkdtempSync(join(tmpdir(), 'tr-')), 'traffic.jsonl');
    m.append(file);
    m.append(file);
    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ playerSeconds: 5 });
    expect(Object.keys(lines[0].byType)).toContain('frame');
    // 個人を特定する項目は持たない(持つ項目は、これだけ)
    expect(Object.keys(lines[0]).sort()).toEqual(['at', 'byType', 'inBps', 'inBytes', 'outBps', 'outBytes', 'playerSeconds', 'seconds', 'zipRatio']);
    m.reset();
    expect(m.snapshot().out.bytes).toBe(0);
  });
});
