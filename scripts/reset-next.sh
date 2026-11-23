#!/bin/sh
# 次期バージョンのデータ(世界・会社・記録)を、すべて消して、新しい世界で起動し直す。
# 本稼働のデータとアカウントには、触れない(次期バージョンは、本稼働のデータを読み取り専用でしか見ない)。
. "$(dirname "$0")/env-common.sh"
need_live_src
versions
echo "次期バージョンのデータを消します(本稼働には影響しません)。"
dc stop server-next
dc rm -f server-next >/dev/null
docker volume rm "${PROJECT}_next-data" >/dev/null 2>&1 || true
dc up -d --build server-next web
echo "次期バージョンを、新しい世界で起動しました($NEXT_VERSION)"
