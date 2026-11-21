#!/usr/bin/env bash
# End-to-end test of the writing pipeline against a scripted stand-in model.
# Runs the built app in offline mode pointed at tests/e2e/mock-model.mjs (an
# OpenAI-compatible endpoint that recognizes each prompt, logs it, and answers
# with a canned reply), writes a book's first chapters through the real API,
# and asserts on the stored state and on the exact prompts every stage got:
# the editor's desk ruling, the chapter audit and its plot-hole rulings, the
# brief (proposal -> confirmation), and the rolling outline (redraw, pins).
#
#   npm run build && bash tests/e2e/run.sh
#
# No API key and no network needed. Not part of `npm test` (it needs a build).
set -u
cd "$(dirname "$0")/../.."
WORK="$(mktemp -d)"
MODEL_PORT="${MODEL_PORT:-18555}"
APP_PORT="${APP_PORT:-3131}"
node tests/e2e/mock-model.mjs "$WORK/prompts.jsonl" "$MODEL_PORT" > "$WORK/mock.log" 2>&1 &
MOCK=$!
LOOM_OFFLINE=1 LOOM_REVISE_PART_WORDS=200 LOOM_DATA_DIR="$WORK/data" LOCAL_AI_BASE_URL="http://127.0.0.1:$MODEL_PORT/v1" \
  npx next start -p "$APP_PORT" -H 127.0.0.1 > "$WORK/app.log" 2>&1 &
APP=$!
trap 'kill $MOCK $APP 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$APP_PORT/api/health" > /dev/null && break; sleep 0.5; done
node tests/e2e/drive.mjs "http://127.0.0.1:$APP_PORT" "$WORK/prompts.jsonl"
STATUS=$?
# Finish the book: plan to the end, then run the autopilot to the last page.
node tests/e2e/finish.mjs "http://127.0.0.1:$APP_PORT" "$WORK/prompts.jsonl" || STATUS=1
echo "prompts logged to $WORK/prompts.jsonl"
exit $STATUS
