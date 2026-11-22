#!/usr/bin/env bash
# Rivalines: Ubuntu サーバ用ワンショット セットアップ & 起動スクリプト
#
# 注意: 画面だけを静的に配信する(vite preview)。世界を進めるサーバーは起動しないので、ログインやマルチプレイはできない。
#       遊ぶときは README の「サーバーを動かして遊ぶ」(docker compose)を使う。
#
#   bash deploy.sh            Node.js導入(なければ) → 取得/更新 → ビルド → バックグラウンド起動
#   bash deploy.sh stop       停止
#   bash deploy.sh status     状態表示
#   bash deploy.sh logs       ログを追う
#
# 環境変数: REPO_URL, BRANCH, APP_DIR, PORT
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/m-yuito1030/rivalines.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-4173}"

# リポジトリ内から実行された場合はそのディレクトリ、そうでなければ ~/rivalines
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

# 1) Node.js 20+ を用意(なければ NodeSource から 22 を導入)
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

# 2) ソース取得・更新
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

# 3) 依存導入 & ビルド
say "npm install"
npm install --no-audit --no-fund
say "ビルド"
npm run build

# 4) 既存プロセスを止めてバックグラウンド起動
stop_server >/dev/null 2>&1 || true
say "起動 (ポート $PORT)"
nohup npx vite preview --host 0.0.0.0 --port "$PORT" > "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
sleep 3
if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "起動に失敗しました。ログ:"; tail -n 30 "$LOGFILE"; exit 1; fi

# 5) ファイアウォールが有効ならポートを開ける
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  say "ufw: ポート $PORT を許可"
  $SUDO ufw allow "$PORT"/tcp || true
fi

say "完了!  スマホ/PCのブラウザで開いてください"
echo "    http://$(ip_addr):$PORT/"
echo
echo "停止: bash $APP_DIR/scripts/deploy.sh stop   /   ログ: bash $APP_DIR/scripts/deploy.sh logs"
