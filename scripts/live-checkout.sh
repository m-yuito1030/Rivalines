#!/bin/sh
# Check out the code used for production at a release tag (or any version).
# Usage: scripts/live-checkout.sh v0.1.0
. "$(dirname "$0")/env-common.sh"
REF=${1:?"取り出す版(タグ)を指定してください。例: scripts/live-checkout.sh v0.1.0"}
git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "見つかりません: $REF(git fetch --tags をしてください)" >&2; exit 1; }
if [ -d "$LIVE_SRC" ]; then
  git -C "$LIVE_SRC" checkout --detach --quiet "$REF"
else
  git -C "$REPO" worktree add --detach "$LIVE_SRC" "$REF"
fi
echo "本稼働のコード: $LIVE_SRC = $(git -C "$LIVE_SRC" describe --tags --always)"
