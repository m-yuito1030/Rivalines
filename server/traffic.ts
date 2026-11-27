import { deflateRawSync } from 'node:zlib';
import { appendFileSync } from 'node:fs';

/**
 * 通信量の計測(どれだけ送っているか。クラウドの通信料・サーバーの選び方・圧縮の要否を、実測で決めるため)。
 * 数えるのは「合計の大きさ」と「メッセージの種類ごとの大きさ」だけで、だれが・どこから、という情報は持たない(個人情報は取らない)。
 * 大きさは、JSON の文字列を UTF-8 にしたバイト数(圧縮しない場合に、実際に回線を流れる量)。
 * あわせて、一部のメッセージだけ実際に圧縮してみて、圧縮した場合の割合も見積もる(WebSocket の圧縮を入れる価値があるか)。
 */

/** メッセージの種類(JSON の最初の "type")を取り出す。見つからなければ 'other' */
export function msgType(data: string): string {
  const m = /^\{"type":"([A-Za-z_]+)"/.exec(data.slice(0, 48));
  return m ? m[1] : 'other';
}

interface Bucket {
  msgs: number;
  bytes: number;
  /** 圧縮の見積もり用: 試しに圧縮した件数・元の大きさ・圧縮後の大きさ */
  sampled: number;
  sampleRaw: number;
  sampleZip: number;
}
const bucket = (): Bucket => ({ msgs: 0, bytes: 0, sampled: 0, sampleRaw: 0, sampleZip: 0 });

export interface TrafficSnapshot {
  /** 計測した時間(秒) */
  seconds: number;
  /** 接続していた時間の合計(人·秒) */
  playerSeconds: number;
  out: { msgs: number; bytes: number };
  in: { msgs: number; bytes: number };
  byType: Record<string, { msgs: number; bytes: number; share: number; zipRatio: number | null }>;
  /** 1 人が接続している間の、1 秒あたりの平均(バイト) */
  perPlayer: { outBps: number; inBps: number };
  /** 圧縮した場合の、送信量に対する割合の見積もり(0〜1。見積もれないとき null) */
  zipRatio: number | null;
  /** 同時接続 n 人が、ずっと(24 時間 × 30 日)つながっているとして、1 か月に外へ出る量(GB) */
  monthlyOutGB: Record<string, number>;
}

export class TrafficMeter {
  private out = bucket();
  private inn = { msgs: 0, bytes: 0 };
  private types = new Map<string, Bucket>();
  private playerSeconds = 0;
  private startedAt = Date.now();
  private nth = 0;

  /** 圧縮を試す間隔(N 件に 1 件)。重い処理なので、間引く */
  constructor(private sampleEvery = 64) {}

  /** 送ったメッセージ 1 件を数える */
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

  /** 受け取ったメッセージ 1 件を数える */
  received(bytes: number): void {
    this.inn.msgs++;
    this.inn.bytes += bytes;
  }

  /** 経過時間(秒)のあいだ、n 人が接続していた */
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

  /** 計測を最初からやり直す(1 時間ごとの記録のあとに呼ぶ) */
  reset(): void {
    this.out = bucket();
    this.inn = { msgs: 0, bytes: 0 };
    this.types.clear();
    this.playerSeconds = 0;
    this.startedAt = Date.now();
  }

  /** 画面や記録に出す、1 行の要約 */
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

  /** 1 時間分などの区切りの記録を、1 行の JSON で追記する(再起動しても残る。個人を特定する情報は入らない) */
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
