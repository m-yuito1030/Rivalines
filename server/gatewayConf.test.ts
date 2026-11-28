import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('入口(gateway)の設定', () => {
  it('HTTPS の前段(Caddy)の後ろで、本当の接続元をX-Forwarded-Forから読む(これが無いと全員が同じ接続元になり、登録・ログイン・WebSocket の上限を全員で分け合ってしまう)', () => {
    const conf = readFileSync(new URL('../deploy/nginx.gateway.conf', import.meta.url), 'utf8');
    expect(conf).toMatch(/real_ip_header X-Forwarded-For;/);
    expect(conf).toMatch(/set_real_ip_from 172\.16\.0\.0\/12;/);
    // Only private networks are trusted (a client cannot choose its own address from the internet)
    const trusted = [...conf.matchAll(/set_real_ip_from ([^;]+);/g)].map((m) => m[1]);
    for (const t of trusted) expect(t).toMatch(/^(10\.|172\.16\.|192\.168\.)/);
    // The operator API stays closed
    expect(conf).toMatch(/location ~ \^\(\/live\|\/next\)\?\/api\/admin \{ return 404; \}/);
  });
});
