#!/usr/bin/env bash
# The proof suite must prove it can FAIL.
#
# Each mutant below breaks one real Tetris rule in game.js. A suite worth
# trusting must turn red for every one of them. Survivors are printed loudly:
# they are the exact rules the 24 proofs do not actually constrain.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$DIR/tools/mutate.py" "$@"
