#!/usr/bin/env bash
# Stacks as theorems — a bot that must survive every seed, controls that must
# top out, and a mechanism proof for every rule of the well.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-chromium}"
run() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --virtual-time-budget=180000 --dump-dom \
    "file://$DIR/index.html?verify=$1" 2>/dev/null | grep -o 'VERIFY:{[^<]*' | head -1
}
for m in solution solution-seeds null ablate-rotation ablate-holes ablate-height \
         mech-bag mech-shapes mech-srs mech-srs-table mech-srs-i mech-tspin mech-spin-scoring \
         mech-lock mech-lockout mech-nomino-loss mech-clear mech-score mech-b2b \
         mech-combo mech-gravity mech-hold mech-ghost mech-topout mech-perfect; do
  run "$m"
done
