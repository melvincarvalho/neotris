#!/usr/bin/env bash
# Deterministic staged screenshots for critics and README.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-chromium}"
SHOTS=(title play tetris tspin combo danger level gameover)
for s in "${SHOTS[@]}"; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=1280,720 \
    --virtual-time-budget=60000 \
    --screenshot="$DIR/shots/$s.png" \
    "file://$DIR/index.html?shot=$s" 2>/dev/null
  echo "captured $s"
done
