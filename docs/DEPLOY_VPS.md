# さくら VPS への公開手順

対象: Ubuntu 24.04・メモリ 4GB・docker 導入済み。ドメイン(例: rivalines.com)を取得済み。

## 1. DNS
ドメインの管理画面で、A レコードを VPS の IP アドレスに向ける。`@`(rivalines.com)と `www` の 2 つ。
反映の確認: `dig +short rivalines.com` が VPS の IP を返せばよい。

## 2. ポートを開ける
他のサービスが 80/443 を使っているので、Rivalines は別のポート(既定 8092。`.env` の `WEB_PORT`)で動かす。
さくらのコントロールパネルの「パケットフィルター」で、そのポートの TCP を許可する。VPS の中で ufw を使っている場合は:

    sudo ufw allow 8092/tcp

## 3. 取得と設定

    git clone https://github.com/m-yuito1030/rivalines.git
    cd rivalines
    cp .env.example .env
    nano .env     # DOMAIN と ADMIN_KEY(openssl rand -hex 24 で作る)を書く。公開前は INVITE_CODE も

## 4. 起動

    docker compose -f docker-compose.vps.yml up -d --build

初回はビルドに数分かかる。起動後、`http://VPSのIP:8092/` を開いて動作を確認する。
この状態は HTTP なので、パスワードが暗号化されない。**友人に試してもらう前に、必ず次の「HTTPS」にする**。ログ: `docker compose -f docker-compose.vps.yml logs -f`

## 4b. HTTPS(公開する前に必須)
- すでに 80/443 を使っているプロキシ(nginx など)があるなら、そこに「rivalines.com を `127.0.0.1:8092` へ渡す」1 件を足す。
  WebSocket(`/ws`)を通すため、`Upgrade` / `Connection` ヘッダーの転送も入れる。接続元の IP は `X-Forwarded-For` で渡す。
- 80/443 を使うものが他になければ、Caddy が証明書を自動で取る: `docker compose -f docker-compose.vps.yml --profile https up -d`

## 5. 更新

    git pull
    docker compose -f docker-compose.vps.yml up -d --build

サーバーは終了の合図を受けると世界を保存してから止まる。

## 6. バックアップ(毎日)

    crontab -e
    # 次の 1 行を足す(毎日 4 時)
    0 4 * * * cd ~/rivalines && bash scripts/backup.sh >> ~/backups.log 2>&1

## 7. 運営の操作(通報の確認・停止など)
運営用の API は外には出していない。サーバーの中から:

    docker compose -f docker-compose.vps.yml exec -e ADMIN_KEY="$(grep ^ADMIN_KEY .env | cut -d= -f2)" server npx tsx server/admin.ts reports

## メモ
- 接続元の IP は、手前のプロキシ → nginx → サーバーの順に X-Forwarded-For で渡る(登録・ログインの回数制限に使う)。
- アクセスログは残さない設定。IP アドレスは保存しない。
- メモリ: server 2.8GB・web 256MB・caddy 128MB。OS に約 800MB 残る。
