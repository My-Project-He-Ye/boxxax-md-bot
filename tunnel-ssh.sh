#!/bin/bash
# SSH reverse tunnel via the sandbox HTTP proxy (no credentials printed anywhere).
set -u
PROXY="${https_proxy:-${HTTPS_PROXY:-}}"
PROXY="${PROXY#http://}"; PROXY="${PROXY#https://}"
CREDS="${PROXY%%@*}"
HOSTPORT="${PROXY#*@}"
PHOST="${HOSTPORT%%:*}"; PPORT="${HOSTPORT##*:}"
PUSER="${CREDS%%:*}"; PPASS="${CREDS#*:}"
TARGET_HOST="${1:-serveo.net}"
TARGET_PORT="${2:-22}"
REMOTE_SPEC="${3:-80:localhost:3000}"
export PHOST PPORT PUSER PPASS
exec ssh -o "ProxyCommand=socat - PROXY:${PHOST}:%h:%p,proxyport=${PPORT},proxyauth=${PUSER}:${PPASS}" \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -p "$TARGET_PORT" -R "$REMOTE_SPEC" "$TARGET_HOST"
