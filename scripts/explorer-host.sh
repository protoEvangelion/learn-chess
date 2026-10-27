#!/usr/bin/env bash
# Keeps the explorer gateway and its private tunnel running.
# When the tunnel address changes, publish it so the live site follows this PC.
set -u
PATH="$HOME/.local/bin:$HOME/.local/node/bin:/usr/bin:/bin:$PATH"
ROOT="/home/daisy/learn-chess"
CFG="$HOME/.config/learn-chess"
mkdir -p "$CFG"
exec >>"$CFG/host.log" 2>&1
echo "----- $(date -Is) start pid $$"

exec 9>"$CFG/host.lock"
if ! flock -n 9; then
  echo "already running"
  exit 0
fi

unset EXPLORER_ORIGIN
unset EDGE_CONFIG

gateway_pid=""
tunnel_pid=""

stop_children() {
  if [ -n "$gateway_pid" ]; then
    kill "$gateway_pid" 2>/dev/null || true
  fi
  if [ -n "$tunnel_pid" ]; then
    kill "$tunnel_pid" 2>/dev/null || true
  fi
}
trap stop_children EXIT

listening() {
  ss -ltn | awk '{print $4}' | grep -q '127.0.0.1:3921$'
}

start_gateway() {
  if listening; then
    echo "gateway already listening"
    return
  fi
  cd "$ROOT"
  npm run explorer:gateway >>"$CFG/gateway.log" 2>&1 &
  gateway_pid=$!
  echo "gateway pid $gateway_pid"
}

wait_gateway() {
  local i
  for i in $(seq 1 40); do
    if listening; then
      return 0
    fi
    sleep 0.25
  done
  echo "gateway did not listen"
  return 1
}

start_tunnel() {
  if [ -n "$tunnel_pid" ] && kill -0 "$tunnel_pid" 2>/dev/null; then
    return
  fi
  : >"$CFG/cloudflared.log"
  cloudflared tunnel --url http://127.0.0.1:3921 --no-autoupdate >>"$CFG/cloudflared.log" 2>&1 &
  tunnel_pid=$!
  echo "tunnel pid $tunnel_pid"
}

current_url() {
  grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CFG/cloudflared.log" | head -1
}

publish_url() {
  local url="$1"
  printf '%s\n' "$url" >"$CFG/origin"
  chmod 600 "$CFG/origin"
  local repo="$CFG/origin-publish"
  if [ ! -d "$repo/.git" ]; then
    rm -rf "$repo"
    git clone --depth 1 git@github.com:protoEvangelion/learn-chess.git "$repo" || {
      echo "could not clone the address repo"
      return
    }
  fi
  (
    cd "$repo" || exit 1
    git fetch --depth 1 origin main
    git reset --hard origin/main
    printf '%s\n' "$url" >explorer-origin.url
    git add explorer-origin.url
    if git diff --cached --quiet; then
      echo "address unchanged"
      exit 0
    fi
    export GIT_AUTHOR_NAME='Cursor Agent'
    export GIT_AUTHOR_EMAIL='cursoragent@cursor.com'
    export GIT_COMMITTER_NAME='Cursor Agent'
    export GIT_COMMITTER_EMAIL='cursoragent@cursor.com'
    git commit -m "Publish the explorer tunnel address."
    git push origin HEAD:main
  )
  echo "address pushed host ${url#https://}"
}

wait_url() {
  local url="" i
  for i in $(seq 1 40); do
    url=$(current_url || true)
    if [ -n "$url" ]; then
      printf '%s' "$url"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

start_gateway
wait_gateway || exit 1
start_tunnel
url=$(wait_url) || {
  echo "no tunnel url"
  exit 1
}
echo "tunnel host ${url#https://}"
publish_url "$url"

while true; do
  sleep 20
  if ! listening; then
    echo "gateway down, starting"
    gateway_pid=""
    start_gateway
    wait_gateway || true
  fi
  if [ -z "$tunnel_pid" ] || ! kill -0 "$tunnel_pid" 2>/dev/null; then
    echo "tunnel down, starting"
    tunnel_pid=""
    start_tunnel
    url=$(wait_url || true)
    if [ -n "$url" ]; then
      publish_url "$url"
    fi
  fi
done
