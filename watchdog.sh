#!/bin/bash
# BOXXAXMD watchdog: keeps the bot alive on this machine.
PORT="${PORT:-3457}"
OWNER_NUMBER="${OWNER_NUMBER:-923448072653}"
DIR="$HOME/workspace/whatsapp-md-bot"
if curl -s -m 8 "http://localhost:${PORT}/api/health" | grep -q '"ok":true'; then
  exit 0
fi
echo "[watchdog] bot down, restarting..."
pkill -f "whatsapp-md-bot/index.js" 2>/dev/null
sleep 2
cd "$DIR" || exit 1
PORT="${PORT}" OWNER_NUMBER="${OWNER_NUMBER}" nohup node index.js >> /tmp/boxxaxmd.log 2>&1 &
disown
sleep 6
curl -s -m 8 "http://localhost:${PORT}/api/health" || echo "[watchdog] restart failed"
