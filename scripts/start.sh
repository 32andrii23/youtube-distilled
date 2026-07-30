#!/bin/zsh

set -e

APP_ROOT="${0:A:h:h}"
PYTHON_BIN="$APP_ROOT/.venv/bin/python"
API_PORT=4322
WEB_PORT=4321
WEB_URL="http://localhost:$WEB_PORT"

cd "$APP_ROOT"

if ! command -v codex >/dev/null 2>&1 && ! command -v claude >/dev/null 2>&1; then
  echo "Neither Codex CLI nor Claude CLI is available in PATH."
  exit 1
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Preparing the local Python service…"
  python3 -m venv "$APP_ROOT/.venv"
fi

if ! "$PYTHON_BIN" -c 'import fastapi, uvicorn, youtube_transcript_api' >/dev/null 2>&1; then
  echo "Preparing the local Python service…"
  "$PYTHON_BIN" -m pip install -r "$APP_ROOT/requirements.txt"
fi

if [[ ! -d "$APP_ROOT/node_modules" ]]; then
  echo "Preparing the local web app…"
  npm install
fi

cleanup() {
  trap - INT TERM EXIT
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}

trap cleanup INT TERM EXIT

"$PYTHON_BIN" -m uvicorn backend.main:app --host 127.0.0.1 --port "$API_PORT" &
API_PID=$!

npm run dev -- --host 127.0.0.1 --port "$WEB_PORT" &
WEB_PID=$!

READY=0
for attempt in {1..80}; do
  if curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && curl -fsS "$WEB_URL" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done

if [[ "$READY" -ne 1 ]]; then
  echo "YouTube Distilled did not start correctly."
  exit 1
fi

echo "YouTube Distilled is ready at $WEB_URL"
open "$WEB_URL"

wait "$WEB_PID"
