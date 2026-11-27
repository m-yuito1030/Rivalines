#!/usr/bin/env bash
# Rivalines: a one-shot setup & start script for an Ubuntu server
#
# Note: this only serves the screens statically (vite preview). It does not start the server that advances the world, so login and multiplayer do not work.
#       To play, use "Run the server and play" in the README (docker compose).
#
#   bash deploy.sh            install Node.js (if absent) -> fetch/update -> build -> start in the background
#   bash deploy.sh stop       stop
#   bash deploy.sh status     show the status
#   bash deploy.sh logs       follow the logs
#
# Environment variables: REPO_URL, BRANCH, APP_DIR, PORT
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/m-yuito1030/rivalines.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-4173}"

# If run from inside the repository, that directory; otherwise ~/rivalines
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "${APP_DIR:-}" ]; then :
elif [ -f "$SELF_DIR/../package.json" ] && grep -q '"name": "rivalines"' "$SELF_DIR/../package.json" 2>/dev/null; then APP_DIR="$(cd "$SELF_DIR/.." && pwd)"
else APP_DIR="$HOME/rivalines"; fi

PIDFILE="$APP_DIR/.preview.pid"
LOGFILE="$APP_DIR/preview.log"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
ip_addr() { hostname -I 2>/dev/null | awk '{print $1}'; }

stop_server() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    sleep 1
    pkill -f "vite preview --host 0.0.0.0 --port $PORT" 2>/dev/null || true
    rm -f "$PIDFILE"
    say "停止しました"
  else
    pkill -f "vite preview --host 0.0.0.0 --port $PORT" 2>/dev/null && say "停止しました" || say "起動していません"
    rm -f "$PIDFILE"
  fi
}

case "${1:-start}" in
  stop) stop_server; exit 0 ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "起動中: http://$(ip_addr):$PORT/ (PID $(cat "$PIDFILE"))"; else echo "停止中"; fi
    exit 0 ;;
  logs) exec tail -n 50 -f "$LOGFILE" ;;
  start) ;;
  *) echo "usage: $0 [start|stop|status|logs]"; exit 1 ;;
esac

# 1) Prepare Node.js 20+ (install 22 from NodeSource if absent)
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -v | sed 's/^v//; s/\..*//')"
  [ "$major" -ge 20 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  say "Node.js 22 をインストール(sudo のパスワードを求められることがあります)"
  $SUDO apt-get update -y
  $SUDO apt-get install -y curl git ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
command -v git >/dev/null 2>&1 || { $SUDO apt-get update -y && $SUDO apt-get install -y git; }
say "node $(node -v) / npm $(npm -v)"

# 2) Fetch and update the source
if [ -d "$APP_DIR/.git" ]; then
  say "更新: $APP_DIR ($BRANCH)"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  say "取得: $REPO_URL → $APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# 3) Install dependencies & build
say "npm install"
npm install --no-audit --no-fund
say "ビルド"
npm run build

# 4) Stop any existing process and start in the background
stop_server >/dev/null 2>&1 || true
say "起動 (ポート $PORT)"
nohup npx vite preview --host 0.0.0.0 --port "$PORT" > "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
sleep 3
if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "起動に失敗しました。ログ:"; tail -n 30 "$LOGFILE"; exit 1; fi

# 5) If the firewall is enabled, open the port
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  say "ufw: ポート $PORT を許可"
  $SUDO ufw allow "$PORT"/tcp || true
fi

say "完了!  スマホ/PCのブラウザで開いてください"
echo "    http://$(ip_addr):$PORT/"
echo
echo "停止: bash $APP_DIR/scripts/deploy.sh stop   /   ログ: bash $APP_DIR/scripts/deploy.sh logs"
