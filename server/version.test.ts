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
  it('画面に版を出す場所と、再読み込みの案内の場所がある', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('id="verLine"');
    expect(html).toContain('id="updateBar"');
  });
});
