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
    nano .env     # DOMAIN と ADMIN_KEY(openssl rand -hex 24 で作る)を書く

## 4. 起動

    docker compose -f docker-compose.vps.yml up -d --build

初回はビルドに数分かかる。起動後、`http://VPSのIP:8092/` を開いて動作を確認する。
この状態は HTTP なので、パスワードが暗号化されない。**友人に試してもらう前に、必ず次の「HTTPS」にする**。ログ: `docker compose -f docker-compose.vps.yml logs -f`

## 4b. HTTPS(公開する前に必須)
- すでに 80/443 を使っているプロキシ(nginx など)があるなら、そこに「rivalines.com を `127.0.0.1:8092` へ渡す」1 件を足す。
  WebSocket(`/ws`)を通すため、`Upgrade` / `Connection` ヘッダーの転送も入れる。接続元の IP は `X-Forwarded-For` で渡す。
- 80/443 を使うものが他になければ、Caddy が証明書を自動で取る: `docker compose -f docker-compose.vps.yml --profile https up -d`

### 同じ VPS の別の Caddy に HTTPS を任せる場合
起動を次のコマンドに替える(`PROXY_NETWORK` は相手のネットワーク名。既定は trailpin_default)。

    docker compose -f docker-compose.vps.yml -f docker-compose.proxy.yml up -d --build

相手の Caddy の sites フォルダに、`deploy/rivalines.caddy.example` を `rivalines.caddy` として置き、`caddy validate` のあとで再読み込みする。

## 5. 更新

    git pull
    docker compose -f docker-compose.vps.yml up -d --build

サーバーは終了の合図を受けると世界を保存してから止まる。

## 5b. 次期バージョンのお試し環境
同じアドレスで、本稼働と次期バージョンの2つの世界に入れる。入口(`http://アドレス/`)でログインして、世界を選ぶ。直接開くなら、本稼働は `/live/`、次期バージョンは `/next/`。

- 次期バージョンは小さな世界(2048×2048)で、データは消えてよい。同時接続は30人まで。メモリは 150MB ほど。
- アカウントは本稼働のものをそのまま使う(次期バージョンでの登録・BAN・パスワード変更は、本稼働側に効く)。
- 更新: `git pull` のあと `docker compose -f docker-compose.vps.yml up -d --build`。次期バージョンの世界だけ作り直す(データを消す)なら、`docker compose -f docker-compose.vps.yml stop server-next && docker volume rm rivalines_rivalines-next && docker compose -f docker-compose.vps.yml up -d server-next`(volume 名は `docker volume ls` で確認)。
- 本稼働と次期バージョンで版を分けたいとき: `scripts/live-checkout.sh v0.2.0` で本稼働のコードを `../rivalines-live` に取り出し、`.env` に `LIVE_SRC=../rivalines-live` と書く。書かなければ、両方とも今のコード(`git pull` した版)になる。詳しくは docs/ENVIRONMENTS.md。

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
- メモリ: 本稼働 server 2.8GB・次期 server 0.4GB(実際は 150MB ほど)・web 256MB・caddy 128MB。OS に約 500MB 残る。
