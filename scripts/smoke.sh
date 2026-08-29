#!/usr/bin/env bash
# Serves a built app on one runtime and asks it for a page.
#
# `test/portable.test.js` proves the core imports nothing from `node:`. That is
# the shape of portability, not the fact of it, and the README promises the
# fact: the same app on Node, Bun, Deno and workerd. Nothing ran the other three
# until this did, so the day one of them broke, the claim would have stayed in
# the README and nothing would have failed.
#
#   scripts/smoke.sh <name> <app dir> <port> <command…>
#
# Two requests, because they are different paths through the app. GET renders a
# compiled page. POST reaches a verb export and answers 303, which is the whole
# of how a form works here.

set -euo pipefail

name=$1
dir=$2
port=$3
shift 3

# The server reads the config from its working directory, so the app is where
# the command runs, not where this script was called from.
cd "$dir"

log=$(mktemp)
PORT="$port" "$@" >"$log" 2>&1 &
server=$!

# Kill the server however this exits, including the failures below. Without it a
# runtime that starts but answers wrong leaves a process holding the port, and
# the next runtime in the matrix fails for a reason that is not its own.
cleanup() {
  kill "$server" 2>/dev/null || true
  wait "$server" 2>/dev/null || true
}
trap cleanup EXIT

# Poll rather than sleep a fixed number: workerd through wrangler takes seconds
# to come up and Bun takes milliseconds, and a sleep long enough for the first
# is wasted on every run.
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:$port/" 2>/dev/null; then break; fi
  sleep 1
done

fail() {
  echo "✗ $name: $1"
  echo "--- server output ---"
  cat "$log"
  exit 1
}

body=$(curl -fsS "http://localhost:$port/" 2>/dev/null) || fail "GET / did not answer"
case "$body" in
  *"<title>transclude • TodoMVC</title>"*) ;;
  *) fail "GET / answered without the page's title" ;;
esac

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$port/" \
  -H "origin: http://localhost:$port" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'intent=add&text=from+a+smoke+test')
[ "$status" = "303" ] || fail "POST / answered $status, not 303"

echo "✓ $name: GET 200 with the page, POST 303"
