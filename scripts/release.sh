#!/bin/sh
# Officially release the next version and make it production.
#   1. Tag the current state of main (the version) and push it
#   2. Back up the production data
#   3. Switch the production code to that tag and rebuild production (the production data and accounts carry over as they are)
#   4. Wipe the next version's data and start it again in a fresh world for the next version
# Usage: scripts/release.sh v0.2.0
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
