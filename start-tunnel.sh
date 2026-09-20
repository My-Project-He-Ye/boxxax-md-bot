#!/bin/bash
# Cloudflare quick tunnel -> localhost:3000 (BOXXAXMD pairing page). Free, no account/card.
DIR="$HOME/workspace/whatsapp-md-bot"
cd "$DIR" || exit 1
pkill -f "[c]loudflared tunnel --url http://localhost:3000" 2>/dev/null
sleep 2
rm -f cf-tunnel.log
nohup cloudflared tunnel --url http://localhost:3000 > cf-tunnel.log 2>&1 &
disown
echo "tunnel starting..."
for i in $(seq 1 40); do
  sleep 2
  URL=$(grep -o 'https://[a-z0-9.-]*\.trycloudflare\.com' cf-tunnel.log | head -1)
  if [ -n "$URL" ]; then
    echo "$URL" > live-url.txt
    echo "TUNNEL_URL=$URL"
    exit 0
  fi
done
echo "TUNNEL_FAILED"; tail -8 cf-tunnel.log
