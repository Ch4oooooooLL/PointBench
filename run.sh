#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_ROOT="$PROJECT_DIR/logs"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$LOG_ROOT/$RUN_ID"
LAUNCHER_LOG="$LOG_DIR/launcher.log"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

mkdir -p "$LOG_DIR"
printf '%s\n' "$LOG_DIR" > "$LOG_ROOT/latest-run.txt"

log_launcher() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LAUNCHER_LOG"
}

log_error_context() {
  local code="$1"
  local line="$2"
  local command="$3"
  log_launcher "Launcher error. ExitCode=$code Line=$line Command=$command"
}

run_diag() {
  local name="$1"
  local logfile="$2"
  local workdir="$3"
  shift 3

  {
    printf '\n===== diagnostic: %s =====\n' "$name"
    printf 'cwd=%s\n' "$workdir"
    printf '> %q' "$@"
    printf '\n'
  } >> "$logfile"

  log_launcher "Diagnostic started: $name"
  if (cd "$workdir" && "$@") >> "$logfile" 2>&1; then
    local code=0
    printf 'exit_code=%s\n' "$code" >> "$logfile"
    log_launcher "Diagnostic finished: $name ExitCode=$code"
  else
    local code=$?
    printf 'exit_code=%s\n' "$code" >> "$logfile"
    log_launcher "Diagnostic failed: $name ExitCode=$code"
    return "$code"
  fi
}

trap 'code=$?; log_error_context "$code" "$LINENO" "$BASH_COMMAND"; exit "$code"' ERR

cleanup() {
  local code=$?
  set +e
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null
  fi
  wait "${BACKEND_PID:-}" 2>/dev/null
  wait "${FRONTEND_PID:-}" 2>/dev/null
  log_launcher "Launcher exiting. ExitCode=$code"
}
trap cleanup EXIT INT TERM

if [[ -x "$PROJECT_DIR/backend/.venv/bin/python" ]]; then
  PYTHON_EXE="$PROJECT_DIR/backend/.venv/bin/python"
else
  PYTHON_EXE="${PYTHON:-python3}"
fi

log_launcher "Starting PointBench shell launcher"
log_launcher "Project root: $PROJECT_DIR"
log_launcher "Log directory: $LOG_DIR"
log_launcher "Python executable: $PYTHON_EXE"
log_launcher "PATH: $PATH"

: > "$BACKEND_LOG"
: > "$FRONTEND_LOG"

run_diag "python-version" "$BACKEND_LOG" "$PROJECT_DIR/backend" "$PYTHON_EXE" --version
run_diag "backend-import-check" "$BACKEND_LOG" "$PROJECT_DIR/backend" \
  "$PYTHON_EXE" -c "import sys; print(sys.executable); import fastapi, uvicorn, sqlalchemy, alembic, jose; import app.main; print('backend import ok')" \
  || {
    log_launcher "Backend preflight failed. See $BACKEND_LOG"
    exit 1
  }

run_diag "node-version" "$FRONTEND_LOG" "$PROJECT_DIR/frontend" node --version
run_diag "npm-version" "$FRONTEND_LOG" "$PROJECT_DIR/frontend" npm --version
run_diag "frontend-package-check" "$FRONTEND_LOG" "$PROJECT_DIR/frontend" \
  npm --prefix "$PROJECT_DIR/frontend" ls vite @vitejs/plugin-react react react-dom --depth=0 || true

log_launcher "Starting backend on :8000"
(
  cd "$PROJECT_DIR/backend"
  PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONFAULTHANDLER=1 \
    POINTBENCH_LOG_LEVEL=INFO \
    "$PYTHON_EXE" -X faulthandler -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info --access-log
) > >(tee -a "$BACKEND_LOG" | sed -u 's/^/[backend] /') 2> >(tee -a "$BACKEND_LOG" >&2 | sed -u 's/^/[backend] /' >&2) &
BACKEND_PID=$!
log_launcher "Backend PID=$BACKEND_PID"

log_launcher "Starting frontend on :5173"
(
  cd "$PROJECT_DIR/frontend"
  NODE_OPTIONS="--trace-uncaught --trace-warnings" npm run dev -- --clearScreen false
) > >(tee -a "$FRONTEND_LOG" | sed -u 's/^/[frontend] /') 2> >(tee -a "$FRONTEND_LOG" >&2 | sed -u 's/^/[frontend] /' >&2) &
FRONTEND_PID=$!
log_launcher "Frontend PID=$FRONTEND_PID"

log_launcher "Logs: launcher=$LAUNCHER_LOG backend=$BACKEND_LOG frontend=$FRONTEND_LOG"
log_launcher "Press Ctrl+C to stop."

sleep 4
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  set +e
  wait "$BACKEND_PID"
  backend_code=$?
  set -e
  log_launcher "Backend exited during startup. ExitCode=$backend_code"
  exit "$backend_code"
fi
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  set +e
  wait "$FRONTEND_PID"
  frontend_code=$?
  set -e
  log_launcher "Frontend exited during startup. ExitCode=$frontend_code"
  exit "$frontend_code"
fi

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    set +e
    wait "$BACKEND_PID"
    backend_code=$?
    set -e
    log_launcher "Backend exited. ExitCode=$backend_code"
    exit "$backend_code"
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    set +e
    wait "$FRONTEND_PID"
    frontend_code=$?
    set -e
    log_launcher "Frontend exited. ExitCode=$frontend_code"
    exit "$frontend_code"
  fi
  sleep 1
done
