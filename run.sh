#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_ROOT="$PROJECT_DIR/logs"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$LOG_ROOT/$RUN_ID"
LAUNCHER_LOG="$LOG_DIR/launcher.log"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
ERROR_LOG="$LOG_DIR/errors.log"
PREFLIGHT_REPORT="$LOG_DIR/preflight-report.txt"

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

is_current_launcher_process() {
  local pid="$1"
  [[ "$pid" == "$$" || "$pid" == "${BASHPID:-}" || "$pid" == "$PPID" ]]
}

stop_process_tree() {
  local pid="$1"
  local child

  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_process_tree "$child"
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  fi
}

wait_or_force_stop() {
  local pid="$1"

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return
    fi
    sleep 0.1
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
}

stop_existing_project_processes() {
  local pid cwd cmdline
  local pids=()

  for proc in /proc/[0-9]*; do
    pid="${proc##*/}"
    is_current_launcher_process "$pid" && continue

    cwd="$(readlink "$proc/cwd" 2>/dev/null || true)"
    cmdline="$(tr '\0' ' ' < "$proc/cmdline" 2>/dev/null || true)"
    [[ -n "$cmdline" ]] || continue

    case "$cmdline" in
      *"uvicorn app.main:app"*|*"vite/bin/vite.js"*|*"vite\\bin\\vite.js"*|*"run.sh"*|*"scripts/launcher.ps1"*)
        if [[ "$cwd" == "$PROJECT_DIR"* || "$cmdline" == *"$PROJECT_DIR"* ]]; then
          pids+=("$pid")
        fi
        ;;
    esac
  done

  if [[ "${#pids[@]}" -eq 0 ]]; then
    log_launcher "No existing PointBench process found."
    return
  fi

  log_launcher "Stopping existing PointBench processes: ${pids[*]}"
  for pid in "${pids[@]}"; do
    is_current_launcher_process "$pid" && continue
    stop_process_tree "$pid"
  done
  for pid in "${pids[@]}"; do
    is_current_launcher_process "$pid" && continue
    wait_or_force_stop "$pid"
  done
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

PYTHON_CANDIDATES=(
  "$PROJECT_DIR/runtime/python/bin/python"
  "$PROJECT_DIR/runtime/python/python"
  "$PROJECT_DIR/runtime/python/python.exe"
)
PYTHON_EXE=""
for candidate in "${PYTHON_CANDIDATES[@]}"; do
  if [[ -x "$candidate" ]]; then
    PYTHON_EXE="$candidate"
    break
  fi
done
if [[ -z "$PYTHON_EXE" ]]; then
  log_launcher "Portable Python is missing under runtime/python. Use a complete PointBench portable package."
  exit 1
fi
export PATH="$PROJECT_DIR/runtime/python:$PROJECT_DIR/runtime/python/bin:$PROJECT_DIR/runtime/python/Scripts:$PATH"

NODE_CANDIDATES=(
  "$PROJECT_DIR/runtime/node/bin/node"
  "$PROJECT_DIR/runtime/node/node"
  "$PROJECT_DIR/runtime/node/node.exe"
)
NODE_EXE=""
for candidate in "${NODE_CANDIDATES[@]}"; do
  if [[ -x "$candidate" ]]; then
    NODE_EXE="$candidate"
    break
  fi
done
if [[ -z "$NODE_EXE" ]]; then
  log_launcher "Portable Node.js is missing under runtime/node. Use a complete PointBench portable package."
  exit 1
fi
export PATH="$PROJECT_DIR/runtime/node:$PROJECT_DIR/runtime/node/bin:$PATH"

if [[ ! -f "$PROJECT_DIR/frontend/node_modules/vite/bin/vite.js" ]]; then
  log_launcher "Frontend dependencies are missing: frontend/node_modules/vite/bin/vite.js. Use a complete portable package."
  exit 1
fi
export PYTHONPATH="$PROJECT_DIR/backend${PYTHONPATH:+:$PYTHONPATH}"

log_launcher "Starting PointBench shell launcher"
log_launcher "Project root: $PROJECT_DIR"
log_launcher "Log directory: $LOG_DIR"
log_launcher "Error log: $ERROR_LOG"
log_launcher "Preflight report: $PREFLIGHT_REPORT"
log_launcher "Python executable: $PYTHON_EXE"
log_launcher "PATH: $PATH"

: > "$BACKEND_LOG"
: > "$FRONTEND_LOG"
: > "$ERROR_LOG"

stop_existing_project_processes

run_diag "pointbench-preflight" "$LAUNCHER_LOG" "$PROJECT_DIR" \
  "$PYTHON_EXE" "$PROJECT_DIR/scripts/preflight_check.py" \
  --project-root "$PROJECT_DIR" \
  --python "$PYTHON_EXE" \
  --report "$PREFLIGHT_REPORT" \
  || {
    log_launcher "PointBench preflight failed. See $PREFLIGHT_REPORT"
    exit 1
  }

run_diag "python-version" "$BACKEND_LOG" "$PROJECT_DIR/backend" "$PYTHON_EXE" --version
run_diag "backend-import-check" "$BACKEND_LOG" "$PROJECT_DIR/backend" \
  "$PYTHON_EXE" -c "import sys; print(sys.executable); import fastapi, uvicorn, sqlalchemy, alembic, jose; import app.main; print('backend import ok')" \
  || {
    log_launcher "Backend preflight failed. See $BACKEND_LOG"
    exit 1
  }

run_diag "node-version" "$FRONTEND_LOG" "$PROJECT_DIR/frontend" "$NODE_EXE" --version
NPM_EXE=""
for candidate in "$PROJECT_DIR/runtime/node/bin/npm" "$PROJECT_DIR/runtime/node/npm" "$PROJECT_DIR/runtime/node/npm.cmd"; do
  if [[ -x "$candidate" ]]; then
    NPM_EXE="$candidate"
    break
  fi
done
if [[ -n "$NPM_EXE" ]]; then
  run_diag "npm-version" "$FRONTEND_LOG" "$PROJECT_DIR/frontend" "$NPM_EXE" --version || true
else
  log_launcher "Portable npm was not found; continuing because runtime startup uses node directly."
fi
run_diag "frontend-package-check" "$FRONTEND_LOG" "$PROJECT_DIR/frontend" \
  "$NODE_EXE" -e "for (const p of ['vite','@vitejs/plugin-react','react','react-dom']) require.resolve(p + '/package.json', { paths: [process.cwd()] }); console.log('frontend packages ok')" || true
run_diag "vite-direct-check" "$FRONTEND_LOG" "$PROJECT_DIR/frontend" \
  "$NODE_EXE" ./node_modules/vite/bin/vite.js --version

log_launcher "Starting backend on :8000"
(
  cd "$PROJECT_DIR/backend"
  PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONFAULTHANDLER=1 \
    POINTBENCH_LOG_LEVEL=INFO \
    POINTBENCH_ERROR_LOG="$ERROR_LOG" \
    "$PYTHON_EXE" -X faulthandler -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level info --access-log
) > >(tee -a "$BACKEND_LOG" | sed -u 's/^/[backend] /') 2> >(tee -a "$BACKEND_LOG" >&2 | sed -u 's/^/[backend] /' >&2) &
BACKEND_PID=$!
log_launcher "Backend PID=$BACKEND_PID"

log_launcher "Starting frontend on :5173"
(
  cd "$PROJECT_DIR/frontend"
  NODE_OPTIONS="--trace-uncaught --trace-warnings" "$NODE_EXE" ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --clearScreen false
) > >(tee -a "$FRONTEND_LOG" | sed -u 's/^/[frontend] /') 2> >(tee -a "$FRONTEND_LOG" >&2 | sed -u 's/^/[frontend] /' >&2) &
FRONTEND_PID=$!
log_launcher "Frontend PID=$FRONTEND_PID"

log_launcher "Logs: launcher=$LAUNCHER_LOG errors=$ERROR_LOG backend=$BACKEND_LOG frontend=$FRONTEND_LOG"
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
