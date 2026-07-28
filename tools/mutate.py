#!/usr/bin/env python3
"""Mutation gate for NEOTRIS.

Every mutant here breaks a real Tetris rule. The proof suite must turn red for
each one; any mutant that survives marks a rule the proofs do not constrain.
Run: tools/mutate.sh
"""
import json
import os
import re
import shutil
import subprocess
import sys

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get("CHROME", "chromium")

# The mechanism proofs each isolate one rule. A mutant killed by one of these is
# killed for a REASON. A mutant killed only by a macro run is killed by chaos: a
# 400-piece bot game diverges under almost any change, which tells us nothing
# about whether the rule is actually constrained. The gate reports both.
MECH_MODES = [
    "mech-bag", "mech-shapes", "mech-srs", "mech-srs-table", "mech-srs-i", "mech-tspin",
    "mech-spin-scoring", "mech-lock", "mech-lockout", "mech-nomino-loss",
    "mech-clear", "mech-score", "mech-b2b", "mech-combo", "mech-gravity",
    "mech-hold", "mech-ghost", "mech-topout", "mech-perfect",
]
MACRO_MODES = ["solution", "null", "ablate-rotation", "ablate-holes", "ablate-height"]
MODES = MECH_MODES + MACRO_MODES

# (name, description, find, replace) — each breaks exactly one rule
MUTANTS = [
    ("i-table-is-jlstz", "give the I piece the JLSTZ kick table",
     "const table = p.kind === 'I' ? KICK_I : KICK;", "const table = KICK;"),
    ("no-kicks", "allow only the identity kick",
     "const kicks = table['' + from + to] || [[0, 0]];", "const kicks = [[0, 0]];"),
    ("i-table-unnegated", "un-negate y in the I kick table",
     "  '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],",
     "  '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],"),
    ("jlstz-table-unnegated", "un-negate y in the JLSTZ kick table",
     "  '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],",
     "  '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],"),
    ("swap-s-and-z", "swap the S and Z rotation states",
     "  S: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]], [[1, 1], [2, 1], [0, 2], [1, 2]], [[0, 0], [0, 1], [1, 1], [1, 2]]],",
     "  S: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 2]], [[1, 0], [0, 1], [1, 1], [0, 2]]],"),
    ("t-spawn-flipped", "spawn the T piece pointing down",
     "  T: [[[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [1, 1], [2, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [1, 2]]],",
     "  T: [[[0, 1], [1, 1], [2, 1], [1, 2]], [[1, 0], [1, 1], [2, 1], [1, 2]], [[1, 0], [0, 1], [1, 1], [2, 1]], [[1, 0], [0, 1], [1, 1], [1, 2]]],"),
    ("i-spawn-shifted", "spawn the I piece one column left",
     "  I: [[[0, 1], [1, 1], [2, 1], [3, 1]],", "  I: [[[-1, 1], [0, 1], [1, 1], [2, 1]],"),
    ("bag-is-uniform-random", "replace the 7-bag with uniform random",
     "  for (const k of b) G.queue.push(k);",
     "  for (let z = 0; z < 7; z++) G.queue.push(KINDS[Math.floor(rand() * 7)]);"),
    ("three-corner-becomes-two", "weaken the T-spin rule to two corners",
     "  if (total < 3) return 0;", "  if (total < 2) return 0;"),
    ("every-spin-is-full", "call every T-spin a full spin",
     "  return G.lastKick === 4 ? 2 : 1;        // the far kick upgrades a mini to full",
     "  return 2;"),
    ("spin-needs-no-rotation", "detect a T-spin without a rotation",
     "  if (p.kind !== 'T' || !G.lastWasRotate) return 0;", "  if (p.kind !== 'T') return 0;"),
    ("tetris-scores-as-triple", "pay 500 for a tetris",
     "    base = [0, 100, 300, 500, 800][n] || 0;", "    base = [0, 100, 300, 500, 500][n] || 0;"),
    ("tspin-double-underpaid", "pay a T-spin double like a plain double",
     "    base = [400, 800, 1200, 1600][n] || 0;", "    base = [400, 800, 300, 1600][n] || 0;"),
    ("no-back-to-back", "remove the back-to-back multiplier",
     "  if (hard && G.b2b && base) { base = Math.floor(base * 1.5); label = 'B2B ' + label; }",
     "  if (false && hard && G.b2b && base) { base = Math.floor(base * 1.5); }"),
    ("no-combo-bonus", "remove the combo bonus",
     "    if (G.combo > 0) G.score += 50 * G.combo * L;", "    if (false) G.score += 50 * G.combo * L;"),
    ("combo-never-resets", "never reset the combo counter",
     "    G.combo = -1;                        // any lock that clears nothing breaks the chain",
     "    G.combo = G.combo;"),
    ("clearless-spin-arms-b2b", "let a clearless spin arm back-to-back",
     "    if (spin) {                          // ...and a spin without lines does not arm back-to-back",
     "    if (spin) { G.b2b = true;"),
    ("perfect-clear-inflated", "pay 9999 for every perfect clear",
     "      const pc = [0, 800, 1200, 1800, 2000][n] || 0;", "      const pc = [0, 9999, 9999, 9999, 9999][n] || 0;"),
    ("no-lock-out", "delete the lock-out condition",
     "  } else if (allHidden) {", "  } else if (false && allHidden) {"),
    ("no-block-out", "let a piece spawn inside the stack",
     "  if (!fits(p.kind, p.rot, p.x, p.y)) { G.piece = null; topOut(); return false; }",
     "  if (!fits(p.kind, p.rot, p.x, p.y)) { return true; }"),
    ("minoes-may-leave-the-well", "let cells escape above the buffer",
     "    if (bx < 0 || bx >= W || by >= H || by < 0) return false;  // nothing may leave the well",
     "    if (bx < 0 || bx >= W || by >= H) return false;"),
    ("ghost-never-drops", "make the ghost sit on the piece",
     "  let y = p.y;\n  while (fits(p.kind, p.rot, p.x, y + 1)) y++;\n  return y;", "  return p.y;"),
    ("gravity-is-flat", "make every level fall at the same speed",
     "  return Math.max(1 / 60, Math.pow(0.8 - (l - 1) * 0.007, l - 1));", "  return 1;"),
    ("level-never-rises", "freeze the level at 1",
     "    G.level = 1 + Math.floor(G.lines / 10);", "    G.level = 1;"),
    ("hold-is-unlimited", "allow holding twice in a row",
     "  if (!G.piece || G.holdUsed || G.clearing || G.over) return false;",
     "  if (!G.piece || G.clearing || G.over) return false;"),
    ("hold-keeps-rotation-flag", "let a hold carry the rotation flag",
     "  } else spawnNext();\n  G.lastWasRotate = false;\n  G.holdUsed = true;",
     "  } else spawnNext();\n  G.holdUsed = true;"),
    ("lock-delay-never-expires", "make the lock delay infinite",
     "    if (G.lockT >= LOCK_DELAY) lockPiece();", "    if (false) lockPiece();"),
    ("lock-resets-are-unlimited", "remove the lock-reset budget",
     "  if (G.grounded && G.lockResets < LOCK_RESETS) { G.lockT = 0; G.lockResets++; }",
     "  if (G.grounded) { G.lockT = 0; G.lockResets++; }"),
    ("rows-do-not-collapse", "clear rows without dropping the stack",
     "  while (nb.length < H) nb.unshift(new Array(W).fill(null));",
     "  while (nb.length < H) nb.push(new Array(W).fill(null));"),
    ("hard-drop-pays-nothing", "remove hard-drop points",
     "  G.score += dist * 2;", "  G.score += 0;"),
]


def run_mode(path, mode, budget=180000):
    try:
        out = subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             "--virtual-time-budget=%d" % budget, "--dump-dom",
             "file://%s/index.html?verify=%s" % (path, mode)],
            capture_output=True, text=True, timeout=240).stdout
    except subprocess.TimeoutExpired:
        return {"outcome": "TIMEOUT"}
    m = re.search(r"VERIFY:(\{[^<]*\})", out)
    if not m:
        return {"outcome": "NO-REPORT"}
    try:
        return json.loads(m.group(1))
    except ValueError:
        return {"outcome": "BAD-JSON"}


def failing_modes(path, modes, stop_early=False):
    """Which of these modes turn red?"""
    bad = []
    for mode in modes:
        rep = run_mode(path, mode)
        if rep.get("outcome") != "PASS":
            bad.append(mode)
            if stop_early:
                break
    return bad


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    src = open(os.path.join(DIR, "game.js")).read()

    print("baseline: running %d proofs against unmutated source..." % len(MODES))
    bad = failing_modes(DIR, MODES, stop_early=True)
    if bad:
        print("BASELINE IS NOT GREEN (%s failed) — fix that before mutation testing." % bad[0])
        return 2
    print("baseline: all %d PASS\n" % len(MODES))

    survivors, strong, weak = [], [], []
    # the browser can only read file:// URLs under the project directory, so the
    # mutants live here rather than in the system temp dir
    work = os.path.join(DIR, ".mutants")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    try:
        for name, desc, find, repl in MUTANTS:
            if only and only != name:
                continue
            if find not in src:
                print("  !! %-28s SKIPPED — anchor text not found" % name)
                survivors.append((name, desc + " [ANCHOR LOST]"))
                continue
            mdir = os.path.join(work, name)
            os.makedirs(mdir, exist_ok=True)
            shutil.copy(os.path.join(DIR, "index.html"), mdir)
            open(os.path.join(mdir, "game.js"), "w").write(src.replace(find, repl, 1))
            mech_bad = failing_modes(mdir, MECH_MODES)
            if mech_bad:
                print("  KILLED    %-28s by %s" % (name, ", ".join(mech_bad[:3]) +
                      (" +%d" % (len(mech_bad) - 3) if len(mech_bad) > 3 else "")))
                strong.append((name, desc, mech_bad))
                continue
            macro_bad = failing_modes(mdir, MACRO_MODES, stop_early=True)
            if macro_bad:
                print("  weak      %-28s only %s (chaos, not a targeted proof)" % (name, macro_bad[0]))
                weak.append((name, desc, macro_bad[0]))
            else:
                print("  SURVIVED  %-28s %s" % (name, desc))
                survivors.append((name, desc))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    total = len(strong) + len(weak) + len(survivors)
    print("\n%d/%d killed by a targeted mechanism proof" % (len(strong), total))
    print("%d/%d killed only by a macro run (chaos)" % (len(weak), total))
    print("%d/%d survived everything" % (len(survivors), total))
    if weak:
        print("\nWEAK KILLS — no mechanism proof isolates these rules:")
        for name, desc, by in weak:
            print("  - %s: %s (only %s noticed)" % (name, desc, by))
    if survivors:
        print("\nSURVIVORS — rules nothing constrains:")
        for name, desc in survivors:
            print("  - %s: %s" % (name, desc))
    return 1 if (survivors or weak) else 0


if __name__ == "__main__":
    sys.exit(main())
