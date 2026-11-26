import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

describe('バージョン管理(docs/VERSIONING.md)', () => {
  it('package.json の版は「数字.数字.数字」の形', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('CHANGELOG.md に、いまの版の見出しがある(版を上げたのに書き忘れない)', () => {
    const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    expect(log).toContain(`## [${pkg.version}]`);
  });
  it('CHANGELOG.md の先頭に「未リリース」の欄がある(各 PR が 1 行足す場所。docs/MULTI_AGENT.md)', () => {
    const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    const first = log.indexOf('## [');
    expect(first).toBeGreaterThan(0);
    expect(log.startsWith('## [未リリース]', first)).toBe(true);
  });
  it('エージェント向けの入口(CLAUDE.md・AGENTS.md)と、共同作業の決まりがある', () => {
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'docs/MULTI_AGENT.md']) expect(() => readFileSync(join(ROOT, f), 'utf8'), f).not.toThrow();
    expect(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')).toContain('docs/MULTI_AGENT.md');
  });
  it('画面に版を出す場所と、再読み込みの案内の場所がある', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('id="verLine"');
    expect(html).toContain('id="updateBar"');
  });
});
