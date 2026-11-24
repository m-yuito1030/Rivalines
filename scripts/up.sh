#!/bin/sh
# 入り口・本稼働・次期バージョンを、まとめて作り直して起動する(データは消さない)。
# 使い方: scripts/up.sh            全部
#         scripts/up.sh next       次期バージョンだけ(入り口 web も含む)
. "$(dirname "$0")/env-common.sh"
need_live_src
versions
case "${1:-all}" in
  next) dc up -d --build server-next web ;;
  live) dc up -d --build server web ;;
  *) dc up -d --build ;;
esac
echo "本稼働: $LIVE_VERSION / 次期バージョン: $NEXT_VERSION"
