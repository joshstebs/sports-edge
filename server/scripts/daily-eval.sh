#!/usr/bin/env bash
# SportsEdge daily prediction evaluation (6 AM cron).
# Runs the evaluator; prints the digest ONLY when there were picks to grade
# (empty stdout = silent tick, per the watchdog pattern).
cd /c/Users/jsteb/sports-edge/server || exit 1
OUT=$(pnpm eval 2>&1)
if echo "$OUT" | grep -q "Nothing to evaluate"; then
  exit 0
fi
echo "$OUT"
