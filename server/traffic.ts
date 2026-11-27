import { deflateRawSync } from 'node:zlib';
import { appendFileSync } from 'node:fs';

/**
 * Traffic measurement (how much is sent; to decide cloud transfer costs, which server to pick, and whether compression is needed, from measurements).
 * Only the "total size" and the "size per message kind" are counted; nothing about who or from where is kept (no personal information is collected).
 * Size is the number of bytes of the JSON string as UTF-8 (what actually flows over the wire when not compressed).
 * In addition, a sample of messages is really compressed to estimate the ratio when compressed (whether WebSocket compression is worth adding).
 */

/** Extract the message kind (the first "type" in the JSON). 'other' if not found */
export function msgType(data: string): string {
  const m = /^\{"type":"([A-Za-z_]+)"/.exec(data.slice(0, 48));
  return m ? m[1] : 'other';
}

interface Bucket {
  msgs: number;
  bytes: number;
  /** For the compression estimate: how many were trial-compressed, the original size, and the compressed size */
  sampled: number;
  sampleRaw: number;
  sampleZip: number;
}
const bucket = (): Bucket => ({ msgs: 0, bytes: 0, sampled: 0, sampleRaw: 0, sampleZip: 0 });

export interface TrafficSnapshot {
  /** Measured time (seconds) */
  seconds: number;
  /** Total time connected (person-seconds) */
  playerSeconds: number;
  out: { msgs: number; bytes: number };
  in: { msgs: number; bytes: number };
  byType: Record<string, { msgs: number; bytes: number; share: number; zipRatio: number | null }>;
  /** The average per second while one person is connected (bytes) */
  perPlayer: { outBps: number; inBps: number };
  /** Estimated ratio to the sent volume if compressed (0-1; null if it cannot be estimated) */
  zipRatio: number | null;
  /** The outgoing volume per month (GB), if n concurrent players stay connected all the time (24 hours x 30 days) */
  monthlyOutGB: Record<string, number>;
}

export class TrafficMeter {
  private out = bucket();
  private inn = { msgs: 0, bytes: 0 };
  private types = new Map<string, Bucket>();
  private playerSeconds = 0;
  private startedAt = Date.now();
  private nth = 0;

  /** Interval for trying compression (one in N messages). It is heavy, so it is thinned out */
  constructor(private sampleEvery = 64) {}

  /** Count one sent message */
  sent(data: string | Buffer | ArrayBuffer | Uint8Array): void {
    const isStr = typeof data === 'string';
    const bytes = isStr ? Buffer.byteLength(data) : (data as Uint8Array).byteLength;
    const type = isStr ? msgType(data) : 'binary';
    const b = this.types.get(type) ?? this.types.set(type, bucket()).get(type)!;
    b.msgs++;
    b.bytes += bytes;
    this.out.msgs++;
    this.out.bytes += bytes;
    if (isStr && bytes >= 200 && ++this.nth % this.sampleEvery === 0) {
      const zip = deflateRawSync(data, { level: 1 }).length;
      b.sampled++;
      b.sampleRaw += bytes;
      b.sampleZip += zip;
      this.out.sampled++;
      this.out.sampleRaw += bytes;
      this.out.sampleZip += zip;
    }
  }

  /** Count one received message */
  received(bytes: number): void {
    this.inn.msgs++;
    this.inn.bytes += bytes;
  }

  /** Over the elapsed time (seconds), n people were connected */
  presence(players: number, dtSec: number): void {
    this.playerSeconds += players * dtSec;
  }

  snapshot(): TrafficSnapshot {
    const seconds = Math.max(1, (Date.now() - this.startedAt) / 1000);
    const byType: TrafficSnapshot['byType'] = {};
    for (const [t, b] of [...this.types].sort((a, c) => c[1].bytes - a[1].bytes)) {
      byType[t] = { msgs: b.msgs, bytes: b.bytes, share: this.out.bytes ? b.bytes / this.out.bytes : 0, zipRatio: b.sampleRaw ? b.sampleZip / b.sampleRaw : null };
    }
    const ps = this.playerSeconds;
    const outBps = ps > 0 ? this.out.bytes / ps : 0;
    const month = 30 * 24 * 3600;
    const monthlyOutGB: Record<string, number> = {};
    for (const n of [10, 30, 100]) monthlyOutGB[`${n}人`] = (outBps * n * month) / 1e9;
    return {
      seconds: Math.round(seconds),
      playerSeconds: Math.round(ps),
      out: { msgs: this.out.msgs, bytes: this.out.bytes },
      in: { ...this.inn },
      byType,
      perPlayer: { outBps: Math.round(outBps), inBps: ps > 0 ? Math.round(this.inn.bytes / ps) : 0 },
      zipRatio: this.out.sampleRaw ? this.out.sampleZip / this.out.sampleRaw : null,
      monthlyOutGB,
    };
  }

  /** Start measuring from scratch (call after the hourly record) */
  reset(): void {
    this.out = bucket();
    this.inn = { msgs: 0, bytes: 0 };
    this.types.clear();
    this.playerSeconds = 0;
    this.startedAt = Date.now();
  }

  /** A one-line summary for the screen and the record */
  summary(s: TrafficSnapshot = this.snapshot()): string {
    const mb = (n: number) => (n / 1e6).toFixed(1);
    const top = Object.entries(s.byType)
      .slice(0, 4)
      .map(([t, v]) => `${t} ${(v.share * 100).toFixed(0)}%`)
      .join(' ');
    const avgPlayers = s.seconds ? s.playerSeconds / s.seconds : 0;
    const zip = s.zipRatio === null ? '' : ` / 圧縮すると約${(s.zipRatio * 100).toFixed(0)}%`;
    return `${s.seconds}秒 平均${avgPlayers.toFixed(1)}人: 出 ${mb(s.out.bytes)}MB 入 ${mb(s.in.bytes)}MB / 1人あたり 出 ${(s.perPlayer.outBps / 1000).toFixed(1)}KB/s 入 ${(s.perPlayer.inBps / 1000).toFixed(2)}KB/s${zip} (${top})`;
  }

  /** Append a periodic record (e.g. one hour's worth) as one line of JSON (it survives restarts; nothing that identifies a person is included) */
  append(file: string, s: TrafficSnapshot = this.snapshot()): void {
    const line = {
      at: new Date().toISOString(),
      seconds: s.seconds,
      playerSeconds: s.playerSeconds,
      outBytes: s.out.bytes,
      inBytes: s.in.bytes,
      outBps: s.perPlayer.outBps,
      inBps: s.perPlayer.inBps,
      zipRatio: s.zipRatio,
      byType: Object.fromEntries(Object.entries(s.byType).map(([t, v]) => [t, v.bytes])),
    };
    appendFileSync(file, JSON.stringify(line) + '\n');
  }
}
