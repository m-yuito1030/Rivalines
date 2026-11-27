#!/bin/sh
# Wipe all of the next version's data (world, companies, records) and start it again in a fresh world.
# It does not touch production data or accounts (the next version only views production data read-only).
. "$(dirname "$0")/env-common.sh"
need_live_src
versions
echo "次期バージョンのデータを消します(本稼働には影響しません)。"
dc stop server-next
dc rm -f server-next >/dev/null
docker volume rm "${PROJECT}_next-data" >/dev/null 2>&1 || true
dc up -d --build server-next web
echo "次期バージョンを、新しい世界で起動しました($NEXT_VERSION)"
