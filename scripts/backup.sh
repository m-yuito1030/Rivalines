#!/usr/bin/env bash
# Pack the world and account data (the docker volume rivalines-data) into ~/backups. Backups older than 14 days are deleted.
# Usage: bash scripts/backup.sh   (run it daily from cron; see docs/DEPLOY_VPS.md)
set -euo pipefail
DEST="${BACKUP_DIR:-$HOME/backups}"
mkdir -p "$DEST"
F="$DEST/rivalines-$(date +%Y%m%d-%H%M%S).tar.gz"
docker run --rm -v rivalines-data:/data:ro -v "$DEST":/out alpine tar czf "/out/$(basename "$F")" -C /data .
find "$DEST" -name 'rivalines-*.tar.gz' -mtime +14 -delete
echo "保存しました: $F"
