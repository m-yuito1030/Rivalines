import type { Cmd } from '../src/shared/protocol';

/** Max messages per second per connection (normal play sends about 20/s of view updates plus actions). Excess is dropped; over 3x closes the connection */
export const MSG_PER_SEC = 80;

/** Per-connection rate limit. Call once per received message: 'ok' = handle it / 'drop' = discard it / 'close' = close the connection */
export function messageLimit(now: () => number = Date.now): () => 'ok' | 'drop' | 'close' {
  let windowStart = now();
  let count = 0;
  return () => {
    const t = now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      count = 0;
    }
    count++;
    if (count > MSG_PER_SEC * 3) return 'close';
    return count > MSG_PER_SEC ? 'drop' : 'ok';
  };
}

/** Operations that can stall the server for a while (long auto-laying can take about a second even when it fails) */
export const isHeavy = (cmd: unknown): boolean => !!cmd && typeof cmd === 'object' && (cmd as Cmd).t === 'build' && (cmd as { tool?: unknown }).tool === 'railauto';

/**
 * Server-wide spacing between heavy operations. After one takes T ms, the next is refused for 3T
 * (so all players' heavy operations together use at most a quarter of server time). At least 1.5 s
 */
export class Governor {
  private until = 0;

  constructor(private now: () => number = Date.now) {}

  /** True while heavy operations are refused (the cool-down after the previous one) */
  busy(): boolean {
    return this.now() < this.until;
  }

  /** A heavy operation took ms milliseconds */
  used(ms: number): void {
    this.until = this.now() + Math.max(1500, ms * 3);
  }
}

/**
 * Cap on events per time window (default 1 hour). Used for server-wide new registrations
 * (there is no cap on the number of accounts, but bots must not be able to create a flood of accounts in a short time)
 */
export class WindowLimiter {
  private times: number[] = [];

  constructor(
    private max: number,
    private windowMs = 3_600_000,
    private now: () => number = Date.now,
  ) {}

  /** If one more is allowed, count it and return true. False once the limit is reached */
  tryTake(): boolean {
    const t = this.now();
    while (this.times.length && t - this.times[0] >= this.windowMs) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(t);
    return true;
  }
}

/**
 * Whether a WebSocket connection may come from this page. Browsers always send the Origin of the page that opens the connection, so a page on
 * another site can be refused (it cannot read the player's token anyway; this is an extra layer). No Origin (not a browser) is allowed.
 * Allowed: the same host as the request (Host / X-Forwarded-Host), local development hosts, and the hosts listed in `allowed`
 */
export function originAllowed(origin: string | undefined, host: string | undefined, forwardedHost: string | undefined, allowed: string[] = []): boolean {
  if (!origin) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.host.toLowerCase();
  if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') return true;
  const same = [host, forwardedHost?.split(',')[0]].some((x) => !!x && x.trim().toLowerCase() === h);
  return same || allowed.some((a) => a.trim().toLowerCase() === h);
}
