#!/bin/sh
# Rebuild and start the entrance, production, and the next version together (data is not wiped).
# Usage: scripts/up.sh            everything
#         scripts/up.sh next       only the next version (the entrance web is included too)
. "$(dirname "$0")/env-common.sh"
need_live_src
versions
case "${1:-all}" in
  next) dc up -d --build server-next web ;;
  live) dc up -d --build server web ;;
  *) dc up -d --build ;;
esac
echo "本稼働: $LIVE_VERSION / 次期バージョン: $NEXT_VERSION"
