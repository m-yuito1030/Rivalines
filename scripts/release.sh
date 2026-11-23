#!/bin/sh
# 次期バージョンを、正式リリースして本稼働にする。
#   1. main の今の状態に、タグ(版)を付けて push する
#   2. 本稼働のデータを、バックアップする
#   3. 本稼働のコードを、そのタグに切り替えて、本稼働を作り直す(本稼働のデータとアカウントは、そのまま引き継ぐ)
#   4. 次期バージョンのデータを消して、次の版のために新しい世界で起動し直す
# 使い方: scripts/release.sh v0.2.0
. "$(dirname "$0")/env-common.sh"
TAG=${1:?"版を指定してください。例: scripts/release.sh v0.2.0"}
case "$TAG" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "版は v主.副.修正 の形で指定してください(例: v0.2.0)" >&2; exit 1 ;; esac
cd "$REPO"
[ "$(git branch --show-current)" = main ] || { echo "main ブランチで実行してください" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "コミットしていない変更があります" >&2; exit 1; }
git fetch --quiet origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main がリモートと一致していません(git pull / push してください)" >&2; exit 1; }
git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null && { echo "その版はすでにあります: $TAG" >&2; exit 1; }

echo "== 1/4 タグを付ける: $TAG"
git tag -a "$TAG" -m "Rivalines $TAG"
git push origin "$TAG"

echo "== 2/4 本稼働のデータをバックアップ"
mkdir -p "$REPO/backups"
STAMP=$(date +%Y%m%d-%H%M%S)
docker run --rm -v "${PROJECT}_multi-data:/d:ro" -v "$REPO/backups:/b" alpine tar czf "/b/live-before-$TAG-$STAMP.tgz" -C /d .
echo "   backups/live-before-$TAG-$STAMP.tgz"

echo "== 3/4 本稼働を $TAG に切り替える"
"$HERE/live-checkout.sh" "$TAG"
versions
dc up -d --build server web

echo "== 4/4 次期バージョンのデータを消して、起動し直す"
"$HERE/reset-next.sh"
echo "リリース完了: 本稼働は $TAG になりました。"
