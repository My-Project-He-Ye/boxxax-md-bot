#!/bin/bash
# BOXXAXMD live watchdog — bot + serveo tunnel ko zinda rakhta hai.
# Har 10 min cron se chalta hai. URL change ya failure stdout par batata hai.
DIR="$HOME/workspace/whatsapp-md-bot"
URLFILE="$DIR/live-url.txt"

# --- 1. Bot check ---
if ! curl -s -m 8 http://localhost:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
  echo "BOT DOWN — restarting..."
  if [ -f "$DIR/bot.pid" ]; then kill "$(cat "$DIR/bot.pid")" 2>/dev/null; fi
  # purani atki hui node processes — sirf asal "node index.js" (wrapper bash nahi)
  for p in $(pgrep -f "^node index\.js" 2>/dev/null); do kill "$p" 2>/dev/null; done
  sleep 2
  cd "$DIR" && OWNER_NUMBER=923448072653 PORT=3000 nohup node index.js >> bot.log 2>&1 &
  # nohup ke baad asal node process dhoondho
  sleep 3
  NEWPID=$(pgrep -f "^node index\.js" 2>/dev/null | head -1)
  [ -n "$NEWPID" ] && echo "$NEWPID" > "$DIR/bot.pid"
  sleep 10
  if curl -s -m 8 http://localhost:3000/api/health 2>/dev/null | grep -q '"ok":true'; then
    echo "BOT restarted OK"
  else
    echo "BOT RESTART FAILED — check bot.log"
  fi
fi

# --- 2. Tunnel check ---
if ! pgrep -f "ssh.*serveo\.net" >/dev/null 2>&1; then
  echo "TUNNEL DOWN — restarting..."
  if [ -f "$DIR/tunnel.pid" ]; then kill "$(cat "$DIR/tunnel.pid")" 2>/dev/null; fi
  pkill -f "ssh.*serveo\.net" 2>/dev/null
  cd "$DIR" && nohup ./tunnel-ssh.sh serveo.net 22 "80:localhost:3000" > serveo.log 2>&1 &
  echo $! > "$DIR/tunnel.pid"
  sleep 25
fi

# --- 3. Public URL ---
URL=$(grep -oE "https://[a-zA-Z0-9.-]+\.serveousercontent\.com" "$DIR/serveo.log" 2>/dev/null | tail -1)
if [ -n "$URL" ]; then
  OLD=$(cat "$URLFILE" 2>/dev/null)
  if [ "$URL" != "$OLD" ]; then
    echo "$URL" > "$URLFILE"
    echo "URL CHANGED: ${OLD:-none} -> $URL"
  fi
  if curl -s -m 20 "$URL/api/health" 2>/dev/null | grep -q '"ok":true'; then
    echo "PUBLIC OK: $URL"
  else
    echo "PUBLIC NOT RESPONDING: $URL"
  fi
else
  echo "NO PUBLIC URL in serveo.log yet"
fi
