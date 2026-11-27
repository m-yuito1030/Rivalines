#!/bin/sh
# Shared part of the operation scripts for production (live) and the next version (next). Not run directly (sourced with . from other scripts).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
# The folder that holds the production code (next to this repository). The release tag is checked out there with git worktree
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
