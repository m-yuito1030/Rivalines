/**
 * 運営用のコマンド(サーバーのコンテナの中から使う)。
 *   docker compose exec server npx tsx server/admin.ts reports
 *   docker compose exec server npx tsx server/admin.ts ban <名前|#ID> [理由]
 * 操作: reports / traffic(通信量) / dismiss <通報ID> / players / chat / mute <名前> [分] / announce <タイトル> <本文> / announcements / unannounce <番号> / kick / ban / unban / clear / resetpw / delete
 * ADMIN_KEY は、サーバーと同じ環境変数を使う(公開側の nginx は /api/admin を通さない)
 */
const [action, who = '', ...rest] = process.argv.slice(2);
const key = process.env.ADMIN_KEY ?? '';
const port = process.env.PORT ?? '8091';
if (!action || !key) {
  console.error(
    '使い方: admin <reports|traffic|dismiss|players|chat|mute|announce|announcements|unannounce|kick|ban|unban|clear|resetpw|delete> [名前|#ID|タイトル] [理由|本文]\n(環境変数 ADMIN_KEY が必要です)',
  );
  process.exit(2);
}
const r = await fetch(`http://127.0.0.1:${port}/api/admin`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': key },
  body: JSON.stringify({ action, who, text: rest.join(' ') }),
});
const j = (await r.json()) as { ok: boolean; msg?: string; reason?: string; data?: unknown };
console.log(j.msg ?? j.reason ?? (j.ok ? 'ok' : '失敗'));
if (j.data !== undefined) console.log(JSON.stringify(j.data, null, 2));
process.exit(j.ok ? 0 : 1);
export {};
