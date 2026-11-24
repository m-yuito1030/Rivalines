#!/bin/sh
# 本稼働(live)と次期バージョン(next)の運用スクリプトの共通部分。直接は実行しない(他のスクリプトから . で読み込む)。
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
# 本稼働のコードを置くフォルダ(このリポジトリの隣)。git worktree で、リリースのタグを取り出して置く
LIVE_SRC=${LIVE_SRC:-$REPO/../rivalines-live}
PROJECT=${PROJECT:-simulator-multi}
export LIVE_SRC PROJECT

dc() { (cd "$REPO" && docker compose -p "$PROJECT" "$@"); }

versions() {
  NEXT_VERSION=$(git -C "$REPO" describe --tags --always --dirty 2>/dev/null || echo dev)
  LIVE_VERSION=dev
  [ -d "$LIVE_SRC" ] && LIVE_VERSION=$(git -C "$LIVE_SRC" describe --tags --always 2>/dev/null || echo dev)
  export NEXT_VERSION LIVE_VERSION
}

need_live_src() {
  [ -d "$LIVE_SRC" ] || { echo "本稼働のコードがありません: $LIVE_SRC" >&2; echo "先に scripts/live-checkout.sh <タグ> を実行してください(例: scripts/live-checkout.sh v0.1.0)" >&2; exit 1; }
}
