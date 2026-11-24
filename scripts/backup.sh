#!/usr/bin/env bash
# 世界とアカウントのデータ(docker のボリューム rivalines-data)を ~/backups に固めて保存する。14 日より古いものは消す。
# 使い方: bash scripts/backup.sh   (cron で毎日回すとよい。docs/DEPLOY_VPS.md)
set -euo pipefail
DEST="${BACKUP_DIR:-$HOME/backups}"
mkdir -p "$DEST"
F="$DEST/rivalines-$(date +%Y%m%d-%H%M%S).tar.gz"
docker run --rm -v rivalines-data:/data:ro -v "$DEST":/out alpine tar czf "/out/$(basename "$F")" -C /data .
find "$DEST" -name 'rivalines-*.tar.gz' -mtime +14 -delete
echo "保存しました: $F"
